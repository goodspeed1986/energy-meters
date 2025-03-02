// src/MeterBus.js

const { SerialPort } = require('serialport');
const net = require('net');
const EventEmitter = require('events');

class MeterBus extends EventEmitter {
  constructor(options = {}) {
    super();
    this.meters = new Map();
    this.isConnected = false;
    this.isPolling = false;

    if (options.connectionType === 'tcp') {
      this.connectionType = 'tcp';
      this.socket = new net.Socket();
      this.tcpOptions = {
        host: options.host || '192.168.1.100',
        port: options.port || 502,
        baudRate: options.baudRate || 9600
      };

      this.socket.on('connect', () => {
        this.isConnected = true;
        console.log(`TCP connection established to ${this.tcpOptions.host}:${this.tcpOptions.port}`);
        this.emit('connected');
      });

      this.socket.on('error', (err) => {
        console.error('TCP socket error:', err);
        this.emit('error', err);
      });

      this.socket.on('close', () => {
        this.isConnected = false;
        console.log('TCP connection closed');
        this.emit('disconnected');
      });

      this.socket.connect(this.tcpOptions.port, this.tcpOptions.host);
    } else {
      this.connectionType = 'serial';
      this.serialOptions = {
        path: options.path || 'COM7',
        baudRate: options.baudRate || 9600,
        parity: options.parity || 'none',
        dataBits: options.dataBits || 8,
        stopBits: options.stopBits || 1
      };
      this.port = new SerialPort(this.serialOptions);

      this.port.on('open', () => {
        this.isConnected = true;
        console.log('Serial port opened');
        this.emit('connected');
      });

      this.port.on('error', (err) => {
        console.error('Serial port error:', err);
        this.emit('error', err);
      });
    }
  }

  addMercuryMeter(networkAddress, options = {}) {
    if (this.meters.has(networkAddress)) {
      throw new Error(`Meter with address ${networkAddress} already exists`);
    }
    const meter = new (require('./MercuryMeter'))(networkAddress, options);
    this.meters.set(networkAddress, meter);
    return meter;
  }

  addSpodesMeter(networkAddress, options = {}) {
    if (this.meters.has(networkAddress)) {
      throw new Error(`Meter with address ${networkAddress} already exists`);
    }
    const meter = new (require('./SpodesMeter'))(networkAddress, options);
    this.meters.set(networkAddress, meter);
    return meter;
  }

  addEnergomeraMeter(networkAddress, options = {}) {
    if (this.meters.has(networkAddress)) {
      throw new Error(`Meter with address ${networkAddress} already exists`);
    }
    const meter = new (require('./EnergomeraMeter'))(networkAddress, options);
    this.meters.set(networkAddress, meter);
    return meter;
  }

  getTimeout(baudRate) {
    const timeouts = {
      38400: { systemTimeout: 2, responseTimeout: 150 },
      19200: { systemTimeout: 3, responseTimeout: 150 },
      9600: { systemTimeout: 5, responseTimeout: 150 },
      4800: { systemTimeout: 10, responseTimeout: 180 },
      2400: { systemTimeout: 20, responseTimeout: 250 },
      1200: { systemTimeout: 40, responseTimeout: 400 },
      600: { systemTimeout: 80, responseTimeout: 800 },
      300: { systemTimeout: 160, responseTimeout: 1600 }
    };
    return timeouts[baudRate] || timeouts[9600];
  }

  async sendRequest(request, options = {}) {
    if (!this.isConnected) {
      await new Promise((resolve) => {
        if (this.connectionType === 'tcp') {
          this.socket.once('connect', resolve);
        } else {
          this.port.once('open', resolve);
        }
      });
    }

    const baudRate = this.connectionType === 'tcp' ? this.tcpOptions.baudRate : this.serialOptions.baudRate;
    const defaultTimeout = this.getTimeout(baudRate).responseTimeout;
    const responseTimeout = options.responseTimeout || defaultTimeout;
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 50;

    let attempts = 0;

    while (attempts < maxRetries) {
      console.log(`Sending request (attempt ${attempts + 1}/${maxRetries}): ${request.toString('hex')}`);
      try {
        const response = await new Promise((resolve, reject) => {
          const connection = this.connectionType === 'tcp' ? this.socket : this.port;

          connection.write(request, (err) => {
            if (err) return reject(err);

            const timeout = setTimeout(() => {
              reject(new Error('Response timeout'));
            }, responseTimeout);

            connection.once('data', (data) => {
              clearTimeout(timeout);
              resolve(data);
            });
          });
        });
        console.log(`Received response: ${response.toString('hex')}`);
        return response;
      } catch (error) {
        attempts++;
        console.log(`Attempt ${attempts} failed: ${error.message}`);
        if (attempts === maxRetries) throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  async pollAllMetersSequentially(paramCodes = [], options = {}) {
    const results = new Map();
    const baudRate = this.connectionType === 'tcp' ? this.tcpOptions.baudRate : this.serialOptions.baudRate;
    const { systemTimeout } = this.getTimeout(baudRate);
    const intervalBetweenParams = options.intervalBetweenParams || systemTimeout;
    const intervalBetweenMeters = options.intervalBetweenMeters || systemTimeout;
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 50;
    const responseTimeout = options.responseTimeout || systemTimeout;

    const pollOptions = { intervalBetweenParams, maxRetries, retryDelay, responseTimeout };

    for (const [address, meter] of this.meters) {
      console.log(`Polling meter at address ${address} (0x${address.toString(16)})...`);
      const meterResults = { parameters: {}, errors: [] };

      try {
        console.log(`Opening connection for meter ${address}...`);
        const openRequest = meter.openConnection();
        const openResponse = await this.sendRequest(openRequest, pollOptions);
        console.log(`Meter ${address} open response: ${openResponse.toString('hex')}`);
        if (!meter.verifyResponse(openResponse)) {
          throw new Error('Failed to open connection');
        }
        await new Promise(resolve => setTimeout(resolve, intervalBetweenParams));

        const testRequest = meter.testConnection();
        const testResponse = await this.sendRequest(testRequest, pollOptions);
        console.log(`Meter ${address} test response: ${testResponse.toString('hex')}`);
        if (!meter.verifyResponse(testResponse)) {
          throw new Error('Connection test failed');
        }
        await new Promise(resolve => setTimeout(resolve, intervalBetweenParams));

        for (const paramCode of paramCodes) {
          try {
            const request = meter.readInstantValues(paramCode);
            const response = await this.sendRequest(request, pollOptions);
            console.log(`Meter ${address} instant values response for paramCode 0x${paramCode.toString(16)}: ${response.toString('hex')}`);
            const data = meter.parseInstantValuesResponse(paramCode, response);
            Object.assign(meterResults.parameters, data);
          } catch (error) {
            meterResults.errors.push({ paramCode, error: error.message });
          }
          await new Promise(resolve => setTimeout(resolve, intervalBetweenParams));
        }

        try {
          const energyRequest = meter.readEnergy();
          const energyResponse = await this.sendRequest(energyRequest, pollOptions);
          console.log(`Meter ${address} energy response: ${energyResponse.toString('hex')}`);
          const energyData = meter.parseEnergyResponse(energyResponse);
          Object.assign(meterResults.parameters, energyData);
        } catch (error) {
          meterResults.errors.push({ paramCode: 'energy', error: error.message });
        }
        await new Promise(resolve => setTimeout(resolve, intervalBetweenParams));

        console.log(`Closing connection for meter ${address}...`);
        const closeRequest = meter.closeConnection();
        const closeResponse = await this.sendRequest(closeRequest, pollOptions);
        console.log(`Meter ${address} close response: ${closeResponse.toString('hex')}`);
        if (!meter.verifyResponse(closeResponse)) {
          meterResults.errors.push({ paramCode: 'close', error: error.message });
        }
      } catch (error) {
        meterResults.errors.push({ paramCode: 'connection', error: error.message });
      }

      results.set(address, meterResults);
      this.emit('data', { address, ...meterResults });
      await new Promise(resolve => setTimeout(resolve, intervalBetweenMeters));
    }

    return results;
  }

  async pollAllMetersCyclically(paramCodes = [], options = {}, pollInterval = 5000) {
    if (this.isPolling) return;
    this.isPolling = true;

    const pollOptions = {
      intervalBetweenParams: options.intervalBetweenParams || 100,
      intervalBetweenMeters: options.intervalBetweenMeters || 200,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 50,
      responseTimeout: options.responseTimeout || 500
    };

    while (this.isPolling) {
      try {
        console.log('Starting polling cycle...');
        const pollResults = await this.pollAllMetersSequentially(paramCodes, pollOptions);
        this.emit('cycleComplete', pollResults);
        console.log(`Cycle completed. Waiting ${pollInterval} ms before next poll...`);
      } catch (error) {
        console.error('Polling cycle error:', error);
        this.emit('error', error);
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  stopPolling() {
    this.isPolling = false;
  }

  async close() {
    if (!this.isConnected) return;
    this.stopPolling();
    return new Promise((resolve, reject) => {
      if (this.connectionType === 'tcp') {
        this.socket.destroy();
        this.isConnected = false;
        resolve();
      } else {
        this.port.close((err) => {
          if (err) return reject(err);
          this.isConnected = false;
          resolve();
        });
      }
    });
  }
}

module.exports = MeterBus;