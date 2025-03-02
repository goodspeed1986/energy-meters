// src/SpodesMeter.js

const Meter = require('./Meter');

class SpodesMeter extends Meter {
  constructor(networkAddress, options = {}) {
    super(networkAddress, options);
    this.accessLevel = options.accessLevel || 1;
    this.password = options.password || Buffer.from([1, 1, 1, 1, 1, 1]);
    this.clientAddress = options.clientAddress || 0x01;
    this.logicalName = options.logicalName || '0.0.1.0.0.255';
  }

  createRequest(commandCode, params = []) {
    const buffer = Buffer.concat([
      Buffer.from([this.networkAddress]),
      Buffer.from([commandCode]),
      Buffer.from(params)
    ]);
    const crc = this.calculateCRC16(buffer);
    return Buffer.concat([buffer, crc]);
  }

  verifyResponse(response) {
    if (response.length < 3) return false;
    const data = response.slice(0, -2);
    const receivedCRC = response.slice(-2);
    const calculatedCRC = this.calculateCRC16(data);
    return receivedCRC.equals(calculatedCRC);
  }

  openConnection() {
    if (this.password.length !== 6) throw new Error('Password must be 6 bytes');
    const params = [this.accessLevel, this.clientAddress, ...this.password];
    return this.createRequest(0x01, params);
  }

  closeConnection() {
    return this.createRequest(0x02);
  }

  readByOBIS(obisCode) {
    const obisBytes = obisCode.split('.').map(num => parseInt(num, 10));
    if (obisBytes.length !== 6) throw new Error('Invalid OBIS code format');
    const params = [0xC0, 0x01, ...obisBytes];
    return this.createRequest(0x08, params);
  }

  parseOBISResponse(response) {
    console.log(`Raw OBIS response: ${response.toString('hex')}`);
    if (!this.verifyResponse(response)) {
      throw new Error('Invalid OBIS response');
    }
    const dataStart = 3;
    const dataLength = response.readUInt8(dataStart);
    const data = response.slice(dataStart + 1, dataStart + 1 + dataLength);

    if (data.length === 3) {
      const int32Buf = Buffer.from([0, data[0] & 0x3F, data[2], data[1]]);
      return int32Buf.readUInt32BE(0) / 100;
    } else if (data.length === 4) {
      return data.readUInt32BE(0) / 1000;
    } else if (data.length === 2) {
      return data.readUInt16BE(0) / 1000;
    }
    throw new Error('Unsupported OBIS response format');
  }

  async readInstantParameters(sendRequest, options) {
    const instantParams = {
      '1.0.32.7.0.255': 'u1',
      '1.0.52.7.0.255': 'u2',
      '1.0.72.7.0.255': 'u3',
      '1.0.31.7.0.255': 'i1',
      '1.0.51.7.0.255': 'i2',
      '1.0.71.7.0.255': 'i3',
      '1.0.1.7.0.255': 'P0',
      '1.0.21.7.0.255': 'P1',
      '1.0.41.7.0.255': 'P2',
      '1.0.61.7.0.255': 'P3',
      '1.0.3.7.0.255': 'Q0',
      '1.0.23.7.0.255': 'Q1',
      '1.0.43.7.0.255': 'Q2',
      '1.0.63.7.0.255': 'Q3',
      '1.0.9.7.0.255': 'S0',
      '1.0.29.7.0.255': 'S1',
      '1.0.49.7.0.255': 'S2',
      '1.0.69.7.0.255': 'S3',
      '1.0.13.7.0.255': 'cosTotal',
      '1.0.33.7.0.255': 'cos1',
      '1.0.53.7.0.255': 'cos2',
      '1.0.73.7.0.255': 'cos3',
      '1.0.14.7.0.255': 'frequency'
    };

    const result = {};
    for (const [obisCode, paramName] of Object.entries(instantParams)) {
      try {
        const request = this.readByOBIS(obisCode);
        const response = await sendRequest(request, options);
        result[paramName] = this.parseOBISResponse(response);
      } catch (error) {
        console.error(`Error reading OBIS ${obisCode}: ${error.message}`);
      }
    }
    return result;
  }

  async readEnergyParameters(sendRequest, options) {
    const energyParams = {
      '1.0.1.8.0.255': 'EAP',
      '1.0.2.8.0.255': 'EAM',
      '1.0.3.8.0.255': 'ERP',
      '1.0.4.8.0.255': 'ERM'
    };

    const result = {};
    for (const [obisCode, paramName] of Object.entries(energyParams)) {
      try {
        const request = this.readByOBIS(obisCode);
        const response = await sendRequest(request, options);
        result[paramName] = this.parseOBISResponse(response);
      } catch (error) {
        console.error(`Error reading energy OBIS ${obisCode}: ${error.message}`);
      }
    }
    return result;
  }

  readInstantValues(paramCode) {
    return this.readByOBIS(paramCode === 0x11 ? '1.0.32.7.0.255' : '1.0.1.7.0.255'); // Пример адаптации
  }

  readEnergy() {
    return this.readByOBIS('1.0.1.8.0.255');
  }

  parseInstantValuesResponse(response) {
    return this.parseOBISResponse(response);
  }

  parseEnergyResponse(response) {
    return this.parseOBISResponse(response);
  }
}

module.exports = SpodesMeter;