// test.js
const { MeterBus, MercuryMeter } = require('./index');

// Создаём одну шину для всех счётчиков Меркурий
const bus = new MeterBus({
  connectionType: 'tcp',
  host: '176.193.75.143',
  port: 4001,
  baudRate: 9600
});

// Добавляем несколько счётчиков Меркурий с разными адресами
bus.addMercuryMeter(0x4B, { accessLevel: 1, password: Buffer.from([1, 1, 1, 1, 1, 1]) });
//bus.addMercuryMeter(0x4C, { accessLevel: 1, password: Buffer.from([2, 2, 2, 2, 2, 2]) });
//bus.addMercuryMeter(0x4D, { accessLevel: 1, password: Buffer.from([3, 3, 3, 3, 3, 3]) });

// Список всех реализованных параметров мгновенных значений
const paramCodes = [
  0x00, // P0, P1, P2, P3 (активная мощность)
  0x04, // Q0, Q1, Q2, Q3 (реактивная мощность)
  0x08, // S0, S1, S2, S3 (полная мощность)
  0x11, // U1 (напряжение фаза 1)
  0x12, // U2 (напряжение фаза 2)
  0x13, // U3 (напряжение фаза 3)
  0x21, // I1 (ток фаза 1)
  0x22, // I2 (ток фаза 2)
  0x23, // I3 (ток фаза 3)
  0x30, // cosTotal, cos1, cos2, cos3 (коэффициенты мощности)
  0x40  // frequency (частота)
];

const options = {
  intervalBetweenParams: 100,  // Интервал между параметрами одного счётчика
  intervalBetweenMeters: 200,  // Интервал между счётчиками
  maxRetries: 5,               // Максимум попыток при ошибке
  retryDelay: 200,             // Задержка между попытками
  responseTimeout: 1000         // Тайм-аут ожидания ответа
};

bus.on('data', (result) => {
  console.log(`Meter ${result.address} (0x${result.address.toString(16)}):`);
  console.log('  Parameters:', JSON.stringify(result.parameters, null, 2));
  if (result.errors.length > 0) {
    console.log('  Errors:', result.errors);
  }
});

bus.on('cycleComplete', (results) => {
  console.log('Polling cycle completed:', JSON.stringify(results, null, 2));
});

bus.on('error', (error) => {
  console.error('Polling error:', error);
});

// Запускаем циклический опрос всех параметров и энергии
bus.pollAllMetersCyclically(paramCodes, options, 5000).catch(async (error) => {
  console.error('Critical error:', error);
  await bus.close();
});