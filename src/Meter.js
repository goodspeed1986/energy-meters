// src/Meter.js

class Meter {
    constructor(networkAddress, options = {}) {
      this.networkAddress = networkAddress;
      this.options = options;
    }
  
    calculateCRC16(buffer) {
      let crc = 0xFFFF;
      for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
          if (crc & 0x0001) {
            crc = (crc >> 1) ^ 0xA001;
          } else {
            crc >>= 1;
          }
        }
      }
      return Buffer.from([crc & 0xFF, crc >> 8]);
    }
  
    createRequest(cmd, data = []) {
      throw new Error('createRequest must be implemented by subclass');
    }
  
    verifyResponse(response) {
      throw new Error('verifyResponse must be implemented by subclass');
    }
  
    testConnection() {
      throw new Error('testConnection must be implemented by subclass');
    }
  
    openConnection() {
      throw new Error('openConnection must be implemented by subclass');
    }
  
    closeConnection() {
      throw new Error('closeConnection must be implemented by subclass');
    }
  
    readInstantValues(paramCode) {
      throw new Error('readInstantValues must be implemented by subclass');
    }
  
    readEnergy() {
      throw new Error('readEnergy must be implemented by subclass');
    }
  
    parseInstantValuesResponse(response) {
      throw new Error('parseInstantValuesResponse must be implemented by subclass');
    }
  
    parseEnergyResponse(response) {
      throw new Error('parseEnergyResponse must be implemented by subclass');
    }
  }
  
  module.exports = Meter;