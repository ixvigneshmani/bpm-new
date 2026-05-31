import { describe, expect, it } from 'vitest';
import { mapWmTypeToBpmn, resolveNodeKind } from './wm-type-mapping';

describe('mapWmTypeToBpmn', () => {
  it('maps known webMethods TYPE codes', () => {
    expect(mapWmTypeToBpmn(1)).toBe('serviceTask');
    expect(mapWmTypeToBpmn(31)).toBe('userTask');
    expect(mapWmTypeToBpmn(40)).toBe('exclusiveGateway');
    expect(mapWmTypeToBpmn(30)).toBe('serviceTask');
    expect(mapWmTypeToBpmn(50)).toBe('callActivity');
    expect(mapWmTypeToBpmn(110)).toBe('endEvent');
    expect(mapWmTypeToBpmn(35)).toBe('intermediateCatchEvent');
  });

  it('falls back to serviceTask for unknown/null codes', () => {
    expect(mapWmTypeToBpmn(999)).toBe('serviceTask');
    expect(mapWmTypeToBpmn(null)).toBe('serviceTask');
    expect(mapWmTypeToBpmn(undefined)).toBe('serviceTask');
  });
});

describe('resolveNodeKind (icon-geometry guard)', () => {
  it('keeps a gateway when its icon is small and square (~34×34)', () => {
    expect(resolveNodeKind(40, 34, 34)).toBe('exclusiveGateway');
  });

  it('reclassifies a gateway-mapped step with a task-sized icon as serviceTask', () => {
    // 93×60 is the webMethods activity/task icon — must NOT be a diamond.
    expect(resolveNodeKind(40, 93, 60)).toBe('serviceTask');
  });

  it('reclassifies a wide near-square but large icon as serviceTask', () => {
    expect(resolveNodeKind(40, 80, 70)).toBe('serviceTask'); // maxDim > 60
  });

  it('trusts the TYPE map when icon geometry is missing', () => {
    expect(resolveNodeKind(40, 0, 0)).toBe('exclusiveGateway');
    expect(resolveNodeKind(40, null, null)).toBe('exclusiveGateway');
  });

  it('never upgrades a non-gateway type to a gateway', () => {
    // A small square icon on a task type stays a task.
    expect(resolveNodeKind(31, 34, 34)).toBe('userTask');
    expect(resolveNodeKind(1, 34, 34)).toBe('serviceTask');
    expect(resolveNodeKind(110, 28, 28)).toBe('endEvent');
  });

  it('leaves task/event/user/call kinds untouched regardless of icon', () => {
    expect(resolveNodeKind(30, 93, 60)).toBe('serviceTask');
    expect(resolveNodeKind(31, 93, 60)).toBe('userTask');
    expect(resolveNodeKind(50, 28, 28)).toBe('callActivity');
  });
});
