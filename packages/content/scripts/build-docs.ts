// Обновить docs/TASK_FORMAT.md и docs/examples/*.yaml из кода: npm run docs:tasks
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLE_QUIZ, EXAMPLE_TASK, buildReference } from '../src/spec';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs');
fs.mkdirSync(path.join(docs, 'examples'), { recursive: true });
const write = (rel: string, text: string) => { fs.writeFileSync(path.join(docs, rel), text.replace(/\r\n/g, '\n'), 'utf8'); console.log('записан', `docs/${rel}`); };
write('TASK_FORMAT.md', buildReference());
write('examples/example-task.yaml', EXAMPLE_TASK);
write('examples/example-quiz.yaml', EXAMPLE_QUIZ);
