/// <reference types="bun-types" />

import { beforeEach, afterEach, describe, expect, test, spyOn } from 'bun:test';
import { createModuleLogger, setLogger } from './logger';

// Module-level capture before any setLogger — late-binding contract
const logger = createModuleLogger('LateBind');

function makeSpy() {
  return {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  };
}

describe('logger late binding', () => {
  beforeEach(() => {
    setLogger(null);
  });

  afterEach(() => {
    setLogger(null);
  });

  test('forwards info/error/warn/debug to injected logger', () => {
    const spy = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
    const errorSpy = spyOn(spy, 'error');
    const warnSpy = spyOn(spy, 'warn');
    const infoSpy = spyOn(spy, 'info');
    const debugSpy = spyOn(spy, 'debug');

    setLogger(spy);

    logger.info('hi', { n: 1 });
    expect(infoSpy).toHaveBeenCalledWith('hi', { n: 1 });

    logger.error('err', 42);
    expect(errorSpy).toHaveBeenCalledWith('err', 42);

    logger.warn('warn', 'a', 'b');
    expect(warnSpy).toHaveBeenCalledWith('warn', 'a', 'b');

    logger.debug('dbg');
    expect(debugSpy).toHaveBeenCalledWith('dbg');
  });

  test('is silent without injection', () => {
    const spy = makeSpy();
    const infoSpy = spyOn(spy, 'info');
    setLogger(null);
    logger.info('silent');
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('is silent after setLogger(null)', () => {
    const spy = makeSpy();
    const infoSpy = spyOn(spy, 'info');
    setLogger(spy);
    setLogger(null);
    logger.info('silent');
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('setLogger(console) accepts console without cast', () => {
    setLogger(console);
    expect(() => logger.info('console ok')).not.toThrow();
  });
});
