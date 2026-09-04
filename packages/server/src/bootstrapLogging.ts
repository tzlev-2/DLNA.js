import { setLoggerFactory } from 'dlna.js';
import { createModuleLogger } from './logger';
setLoggerFactory(createModuleLogger);
