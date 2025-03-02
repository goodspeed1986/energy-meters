// src/EnergomeraMeter.js

const Meter = require('./Meter');

class EnergomeraMeter extends Meter {
  constructor(networkAddress, options = {}) {
    super(networkAddress, options);
    this.sourceAddress = options.sourceAddress || 0xFF;
    this.username = options.username || '111';
    this.password = options.password || '222';
    this.sessionTimeout = options.sessionTimeout || 255;
    this.isSessionOpen = false;
  }

  calculateCRC16(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
      crc = (crc << 8) ^ this.crc16Table[(crc >> 8) ^ buffer[i]];
    }
    return Buffer.from([crc & 0xFF, crc >> 8]);
  }

  crc16Table = [
    0x0000, 0xC0C1, 0xC181, 0x0140, 0xC301, 0x03C0, 0x0280, 0xC241,
    0xC601, 0x06C0, 0x0780, 0xC741, 0x0500, 0xC5C1, 0xC481, 0x0440,
    // Полная таблица CRC16-IBM опущена для краткости
  ].slice(0, 256); // Замените на полную таблицу

  createFullPacket(cmd, data = []) {
    const appPacket = Buffer.concat([Buffer.from([cmd]), Buffer.from(data)]);
    const netPacket = Buffer.concat([
      Buffer.from([this.networkAddress]),
      Buffer.from([this.sourceAddress]),
      appPacket
    ]);
    const crc = this.calculateCRC16(netPacket);
    const crcPacket = Buffer.concat([netPacket, crc]);
    let body = [];
    for (const byte of crcPacket) {
      if (byte === 0x10) {
        body.push(0x10, 0x10);
      } else {
        body.push(byte);
      }
    }
    return Buffer.concat([
      Buffer.from([0x10, 0x02]),
      Buffer.from(body),
      Buffer.from([0x10, 0x03])
    ]);
  }

  verifyResponse(response) {
    if (response[0] !== 0x10 || response[1] !== 0x02 || response[response.length - 2] !== 0x10 || response[response.length - 1] !== 0x03) {
      return false;
    }
    let body = [];
    for (let i = 2; i < response.length - 2; i++) {
      if (response[i] === 0x10 && response[i + 1] === 0x10) {
        body.push(0x10);
        i++;
      } else {
        body.push(response[i]);
      }
    }
    const packet = Buffer.from(body);
    const data = packet.slice(0, -2);
    const crcReceived = packet.slice(-2);
    const crcCalculated = this.calculateCRC16(data);
    return crcReceived.equals(crcCalculated);
  }

  parseResponse(response) {
    const packet = this.verifyResponse(response) ? Buffer.from(response.slice(2, -2).filter((b, i, arr) => !(b === 0x10 && arr[i + 1] === 0x10))) : null;
    if (!packet) throw new Error('Invalid BSC frame');
    const data = packet.slice(0, -2);
    const cmd = data[2];
    const responseData = data.slice(3);
    return { cmd, data: responseData };
  }

  openConnection() {
    const usernameBuf = Buffer.alloc(8, 0);
    const passwordBuf = Buffer.alloc(8, 0);
    Buffer.from(this.username).copy(usernameBuf);
    Buffer.from(this.password).copy(passwordBuf);
    const data = Buffer.concat([Buffer.from([this.sessionTimeout]), usernameBuf, passwordBuf]);
    return this.createFullPacket(0x0C, data);
  }

  closeConnection() {
    return this.createFullPacket(0x0B);
  }

  readInstantValues(paramCode) {
    const timeBuf = Buffer.alloc(4);
    timeBuf.writeUInt32LE(Math.floor(Date.now() / 1000) - 978307200); // Время в секундах с 01.01.2001
    const data = Buffer.concat([Buffer.from([0]), timeBuf, Buffer.from([paramCode])]);
    return this.createFullPacket(0x03, data);
  }

  readEnergy() {
    const timeBuf = Buffer.alloc(4);
    timeBuf.writeUInt32LE(Math.floor(Date.now() / 1000) - 978307200);
    const data = Buffer.concat([Buffer.from([0]), timeBuf, Buffer.from([0, 6, 0])]);
    return this.createFullPacket(0x02, data);
  }

  parseInstantValuesResponse(response) {
    const { cmd, data } = this.parseResponse(response);
    if (cmd !== 0x83) throw new Error('Invalid instant values response command');
    const type = data[5];
    const status = data[6];
    const result = {};
    if (status === 0 || status === 3) {
      const value = data.readFloatLE(7);
      const paramNames = [
        'Sa', 'Sb', 'Sc', 'S', 'Pa', 'Pb', 'Pc', 'P', 'Qa', 'Qb', 'Qc', 'Q',
        'Ia', 'Ib', 'Ic', 'Va', 'Vb', 'Vc', 'CosFi', 'SinFi', 'UUab', 'UUbc',
        'UUca', 'IUa', 'IUb', 'IUc', 'f'
      ];
      result[paramNames[type]] = value;
    }
    return result;
  }

  parseEnergyResponse(response) {
    const { cmd, data } = this.parseResponse(response);
    if (cmd !== 0x82) throw new Error('Invalid energy response command');
    const result = {};
    const channel = data[0];
    const status = data[5];
    const type = data[6];
    const tariff = data[7];
    if (status === 0 || status === 3) {
      const energy = data.readFloatLE(8);
      result[`energy_${channel}_${type}_${tariff}`] = energy;
    }
    return result;
  }
}

module.exports = EnergomeraMeter;