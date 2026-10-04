# Сервис реальной компиляции скетчей ESP32 (arduino-cli + ядро esp32 2.0.17,
# совместимое с API из лекций: ledcSetup / ledcAttachPin).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates python3 python3-serial \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=/usr/local/bin sh

ENV ARDUINO_DIRECTORIES_DATA=/opt/arduino \
    ARDUINO_DIRECTORIES_DOWNLOADS=/opt/arduino/staging \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/user \
    ARDUINO_BOARD_MANAGER_ADDITIONAL_URLS=https://espressif.github.io/arduino-esp32/package_esp32_index.json

RUN arduino-cli core update-index \
 && arduino-cli core install esp32:esp32@2.0.17 \
 && rm -rf /opt/arduino/staging

RUN arduino-cli lib install \
      "DHT sensor library" "Adafruit Unified Sensor" "ESP32Servo@1.2.1" "LiquidCrystal I2C" \
      "Adafruit NeoPixel" "PubSubClient" "ArduinoJson" "Adafruit SSD1306" "Adafruit GFX Library" \
      "Adafruit BusIO" \
 && rm -rf /opt/arduino/staging

WORKDIR /app
COPY server.mjs warmup.ino ./
# Прогреваем кэш: первая сборка ядра и библиотек занимает минуты, дальше — секунды.
RUN mkdir -p /work && node server.mjs --warmup && chown -R node:node /work

ENV PORT=8090 SLOTS=2
EXPOSE 8090
USER node
CMD ["node", "server.mjs"]
