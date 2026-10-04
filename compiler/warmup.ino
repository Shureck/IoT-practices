#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <SPI.h>
#include <DHT.h>
#include <ESP32Servo.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Preferences.h>

DHT dht(4, DHT22);
Servo servo;
LiquidCrystal_I2C lcd(0x27, 16, 2);
Adafruit_NeoPixel strip(8, 5, NEO_GRB + NEO_KHZ800);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
WiFiClient espClient;
PubSubClient mqtt(espClient);
WebServer server(80);
Preferences prefs;

void setup() {
  Serial.begin(115200);
  dht.begin();
  servo.attach(18);
  lcd.init();
  strip.begin();
  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  ledcSetup(0, 5000, 8);
  ledcAttachPin(2, 0);
  JsonDocument doc;
  doc["t"] = dht.readTemperature();
  HTTPClient http;
  http.begin("http://example.com");
  mqtt.setServer("mqtt.iot", 1883);
  server.begin();
  prefs.begin("x", false);
}
void loop() { mqtt.loop(); server.handleClient(); }
