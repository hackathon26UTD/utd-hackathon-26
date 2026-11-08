// HomeBeacon bench bridge for the XIAO ESP32S3: Uno Q sensor lines in on D7, out over USB.
//
//   Uno Q D1 (TX) -> XIAO D7 (RX, GPIO44), GND -> GND. Both 3.3 V logic.
//
// Prints every line from the Uno Q as `UNO {json}` on USB serial (115200). The laptop script
// `npm run uno-to-dashboard` reads those lines and uploads them to the live API.
// If nothing arrives it says so every 5 s, which separates a wiring problem from a Uno Q problem.
// (The full box A firmware will read the same lines and put them into the encrypted mesh.)

#define UNO_RX_PIN 44   // XIAO D7
#define UNO_TX_PIN 43   // XIAO D6 (unused; the Uno Q only talks to us)

unsigned long lines = 0, lastLine = 0, lastStatus = 0, garbage = 0;
String buf;

void setup() {
  Serial.begin(115200);
  Serial1.begin(115200, SERIAL_8N1, UNO_RX_PIN, UNO_TX_PIN);
  delay(1500);
  Serial.println("\n[bridge] HomeBeacon Uno Q bridge on XIAO D7, 115200 baud");
}

void loop() {
  while (Serial1.available()) {
    char c = Serial1.read();
    if (c == '\r') continue;
    if (c != '\n') { if (buf.length() < 300) buf += c; continue; }
    buf.trim();
    if (buf.startsWith("{") && buf.endsWith("}") && buf.indexOf("\"src\":\"unoq\"") >= 0) {
      Serial.print("UNO "); Serial.println(buf);
      lines++; lastLine = millis();
    } else if (buf.length()) {
      garbage++;
      Serial.print("[bridge] other data on D7: "); Serial.println(buf.substring(0, 120));  // shows what the Uno Q is running if it is not our sketch
    }
    buf = "";
  }
  if (millis() - lastStatus > 5000) {
    lastStatus = millis();
    if (!lines) Serial.printf("[bridge] nothing from the Uno Q yet (noise lines: %lu). Check D1->D7, GND->GND, and that the Uno Q sketch is running\n", garbage);
    else if (millis() - lastLine > 5000) Serial.printf("[bridge] Uno Q silent for %lu s (got %lu lines so far)\n", (millis() - lastLine) / 1000, lines);
  }
}
