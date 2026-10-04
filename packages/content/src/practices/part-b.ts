// Практики модуля 3 (лекция 3).
import type { Practice } from '../types';
import { registers } from './m3-registers';
import { humidity } from './m3-humidity';
import { scanner } from './m3-scanner';
import { lcd } from './m3-lcd';
import { blackbox } from './m3-blackbox';
import { mystery } from './m3-mystery';
import { rtos } from './m3-rtos';
import { quiz } from './m3-quiz';

export const PRACTICES_B: Practice[] = [registers, humidity, scanner, lcd, blackbox, mystery, rtos, quiz];
