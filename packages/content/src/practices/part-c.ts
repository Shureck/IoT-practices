// Практики модулей 4–6 (лекции 4–5 и итоговый проект).
import type { Practice } from '../types';
import { wifiLab } from './m4-wifi';
import { weather } from './m4-weather';
import { assistant } from './m4-assistant';
import { webpanel } from './m4-webpanel';
import { report } from './m4-report';
import { quiz4 } from './m4-quiz';
import { mqttHello } from './m5-hello';
import { telemetry } from './m5-telemetry';
import { remote } from './m5-remote';
import { quiz5 } from './m5-quiz';
import { final } from './m6-final';

export const PRACTICES_C: Practice[] = [
  wifiLab, weather, assistant, webpanel, report, quiz4,
  mqttHello, telemetry, remote, quiz5,
  final,
];
