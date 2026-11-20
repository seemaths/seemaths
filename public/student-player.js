import { prepareStudent, watchProgress } from './student-session.js?v=2';

// Resolve the participant before the player creates/restores its browser attempt.
// A temporary reporting outage must never stop the child opening their maths.
const student = await prepareStudent();
await import('/runtime/seemaths-player.js');
watchProgress(student);
