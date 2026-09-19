import type { JobEventType } from '../src/shared/types.ts';

const knownEventType: JobEventType = 'JOB_CREATED';
void knownEventType;

// @ts-expect-error Unbekannte Ereignisse dürfen den zentralen Vertrag nicht erweitern.
const unknownEventType: JobEventType = 'UNKNOWN_EVENT';
void unknownEventType;
