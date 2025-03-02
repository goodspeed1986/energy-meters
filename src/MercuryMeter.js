// src/MercuryMeter.js

const Meter = require('./Meter');

class MercuryMeter extends Meter {
  constructor(networkAddress, options = {}) {
    super(networkAddress, options);
    this.accessLevel = options.accessLevel || 1;
    this.password = options.password || Buffer.from([1, 1, 1, 1, 1, 1]);
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
    if (response.length < 3) {
      console.log(`Response too short: ${response.toString('hex')}, length: ${response.length}`);
      return false;
    }
    const data = response.slice(0, -2);
    const receivedCRC = response.slice(-2);
    const calculatedCRC = this.calculateCRC16(data);
    const isValid = receivedCRC.equals(calculatedCRC);
    console.log(`Verifying response: Data: ${data.toString('hex')}, Received CRC: ${receivedCRC.toString('hex')}, Calculated CRC: ${calculatedCRC.toString('hex')}, Valid: ${isValid}`);
    return isValid;
  }

  testConnection() {
    const request = this.createRequest(0x00);
    console.log(`Test connection request: ${request.toString('hex')}`);
    return request;
  }

  openConnection() {
    if (this.password.length !== 6) throw new Error('Password must be 6 bytes');
    const params = [this.accessLevel, ...this.password];
    const request = this.createRequest(0x01, params);
    console.log(`Open connection request: ${request.toString('hex')}`);
    return request;
  }

  closeConnection() {
    const request = this.createRequest(0x02);
    console.log(`Close connection request: ${request.toString('hex')}`);
    return request;
  }

  readInstantValues(paramCode) {
    let subCommand = 0;
    if (paramCode === 0x30 || paramCode === 0x00 || paramCode === 0x04 || paramCode === 0x08) {
      subCommand = 0x16; // Подкоманда 0x16 для P, Q, S, cosφ
    } else {
      subCommand = 0x11; // Подкоманда 0x11 для U, I, frequency
    }
    const request = this.createRequest(0x08, [subCommand, paramCode]);
    console.log(`Read instant values request for paramCode 0x${paramCode.toString(16)}: SubCommand: 0x${subCommand.toString(16)}, Full request: ${request.toString('hex')}`);
    return request;
  }

  readEnergy() {
    const request = this.createRequest(0x05, [0x00, 0x00]);
    console.log(`Read energy request: ${request.toString('hex')}`);
    return request;
  }

  parseInstantValuesResponse(paramCode, response) {
    console.log(`Parsing instant values for paramCode 0x${paramCode.toString(16)}: Raw response: ${response.toString('hex')}`);
    if (!this.verifyResponse(response)) {
      throw new Error('Invalid instant values response');
    }

    const parse3ByteValue = (buf) => {
      const int32Buf = Buffer.from([0, 0, 0, 0]);
      int32Buf[1] = buf[0] & 0x3F;
      int32Buf[2] = buf[2];
      int32Buf[3] = buf[1];
      const value = int32Buf.readUInt32BE(0);
      console.log(`Parsed 3-byte value from ${buf.toString('hex')} -> ${int32Buf.toString('hex')} = ${value}`);
      return value;
    };

    switch (paramCode) {
      case 0x00:
        if (response.length !== 15) throw new Error('Invalid active power response length');
        return {
          P0: parse3ByteValue(response.slice(1, 4)) / 100,
          P1: parse3ByteValue(response.slice(4, 7)) / 100,
          P2: parse3ByteValue(response.slice(7, 10)) / 100,
          P3: parse3ByteValue(response.slice(10, 13)) / 100
        };
      case 0x04:
        if (response.length !== 15) throw new Error('Invalid reactive power response length');
        return {
          Q0: parse3ByteValue(response.slice(1, 4)) / 100,
          Q1: parse3ByteValue(response.slice(4, 7)) / 100,
          Q2: parse3ByteValue(response.slice(7, 10)) / 100,
          Q3: parse3ByteValue(response.slice(10, 13)) / 100
        };
      case 0x08:
        if (response.length !== 15) throw new Error('Invalid full power response length');
        return {
          S0: parse3ByteValue(response.slice(1, 4)) / 100,
          S1: parse3ByteValue(response.slice(4, 7)) / 100,
          S2: parse3ByteValue(response.slice(7, 10)) / 100,
          S3: parse3ByteValue(response.slice(10, 13)) / 100
        };
      case 0x11:
        if (response.length !== 6) throw new Error('Invalid U1 response length');
        return { u1: parse3ByteValue(response.slice(1, 4)) / 100 };
      case 0x12:
        if (response.length !== 6) throw new Error('Invalid U2 response length');
        return { u2: parse3ByteValue(response.slice(1, 4)) / 100 };
      case 0x13:
        if (response.length !== 6) throw new Error('Invalid U3 response length');
        return { u3: parse3ByteValue(response.slice(1, 4)) / 100 };
      case 0x21:
        if (response.length !== 6) throw new Error('Invalid I1 response length');
        return { i1: parse3ByteValue(response.slice(1, 4)) / 1000 };
      case 0x22:
        if (response.length !== 6) throw new Error('Invalid I2 response length');
        return { i2: parse3ByteValue(response.slice(1, 4)) / 1000 };
      case 0x23:
        if (response.length !== 6) throw new Error('Invalid I3 response length');
        return { i3: parse3ByteValue(response.slice(1, 4)) / 1000 };
      case 0x30:
        if (response.length !== 15) throw new Error('Invalid power factor response length');
        return {
          cosTotal: parse3ByteValue(response.slice(1, 4)) / 1000,
          cos1: parse3ByteValue(response.slice(4, 7)) / 1000,
          cos2: parse3ByteValue(response.slice(7, 10)) / 1000,
          cos3: parse3ByteValue(response.slice(10, 13)) / 1000
        };
      case 0x40:
        if (response.length !== 6) throw new Error('Invalid frequency response length');
        return { frequency: parse3ByteValue(response.slice(1, 4)) / 100 };
      default:
        throw new Error(`Unsupported paramCode ${paramCode}`);
    }
  }

  parseEnergyResponse(response) {
    console.log(`Parsing energy response: Raw response: ${response.toString('hex')}`);
    if (!this.verifyResponse(response)) {
      throw new Error('Invalid energy response');
    }
    if (response.length !== 19) throw new Error('Invalid energy response length');

    const dataBuf = response.slice(1, 17);
    const buffer = Buffer.alloc(16, dataBuf).swap16();

    const parseEnergyValue = (offset) => {
      const value = buffer.readUInt32BE(offset);
      console.log(`Parsed energy value at offset ${offset}: ${value} -> ${value === 0xFFFFFFFF ? 'null' : value / 1000}`);
      return value === 0xFFFFFFFF ? null : value / 1000;
    };

    return {
      EAP: parseEnergyValue(0),
      EAM: parseEnergyValue(4),
      ERP: parseEnergyValue(8),
      ERM: parseEnergyValue(12)
    };
  }
}

module.exports = MercuryMeter;