#include <Wire.h>

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(8, 9, 100000);
  Serial.println();
  Serial.println("OMV I2C SCAN START");
}

void loop() {
  Serial.println("SCAN");
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("FOUND 0x%02X\n", addr);
      found++;
    }
  }
  Serial.printf("TOTAL %d\n", found);
  delay(2000);
}
