// Практики модулей 1–2 (лекции 1–2).
import type { Practice } from '../types';
import { blink } from './m1-blink';
import { button } from './m1-button';
import { sos } from './m1-sos';
import { traffic } from './m1-traffic';
import { voltmeter } from './m1-voltmeter';
import { nightlight } from './m1-nightlight';
import { lock } from './m1-lock';
import { quiz1 } from './m1-quiz';
import { fade } from './m2-fade';
import { barrier } from './m2-barrier';
import { parking } from './m2-parking';
import { alarm } from './m2-alarm';
import { gas } from './m2-gas';
import { reaction } from './m2-reaction';
import { rgb } from './m2-rgb';
import { quiz2 } from './m2-quiz';

export const PRACTICES_A: Practice[] = [blink, button, sos, traffic, voltmeter, nightlight, lock, quiz1,
  fade, barrier, parking, alarm, gas, reaction, rgb, quiz2];
