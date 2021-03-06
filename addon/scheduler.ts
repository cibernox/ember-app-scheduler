import { Promise } from 'rsvp';
import { run } from '@ember/runloop';
import Router from '@ember/routing/router';
import { DEBUG } from '@glimmer/env';
import { registerWaiter } from '@ember/test';

interface IDeferred {
  isResolved: boolean;
  promise: Promise<any>;
  resolve: Function;
  reject: Function;
}

interface Capabilities {
  requestAnimationFrameEnabled: boolean;
  requestIdleCallbackEnabled: boolean;
}

const APP_SCHEDULER_LABEL: string = 'ember-app-scheduler';
const APP_SCHEDULER_HAS_SETUP: string = '__APP_SCHEDULER_HAS_SETUP__';

let _didTransition: IDeferred;
let _whenRoutePainted: Promise<any>;
let _whenRoutePaintedScheduleFn: Function;
let _whenRouteIdle: Promise<any>;
let _whenRouteIdleScheduleFn: Function;
let _activeScheduledTasks: number = 0;
const CAPABILITIES: Capabilities = {
  requestAnimationFrameEnabled: typeof requestAnimationFrame === 'function',
  requestIdleCallbackEnabled: typeof requestIdleCallback === 'function',
};
let _capabilities = CAPABILITIES;

export const USE_REQUEST_IDLE_CALLBACK: boolean = true;
export const SIMPLE_CALLBACK = (callback: Function) => callback();

reset();

export function beginTransition() {
  if (_didTransition.isResolved) {
    _didTransition = _defer(APP_SCHEDULER_LABEL);
    _whenRoutePainted = _didTransition.promise.then(() =>
      _afterNextPaint(_whenRoutePaintedScheduleFn)
    );
    _whenRouteIdle = _whenRoutePainted.then(() =>
      _afterNextPaint(_whenRouteIdleScheduleFn)
    );
  }
}

export function endTransition() {
  _didTransition.resolve();
}

export function setupRouter(router: Router) {
  if ((router as any)[APP_SCHEDULER_HAS_SETUP]) {
    return;
  }

  (router as any)[APP_SCHEDULER_HAS_SETUP] = true;
  router.on('willTransition', beginTransition);
  router.on('didTransition', endTransition);
}

export function reset() {
  _didTransition = _defer(APP_SCHEDULER_LABEL);
  _whenRoutePainted = _didTransition.promise.then();
  _whenRouteIdle = _whenRoutePainted.then();
  _didTransition.resolve();
  _activeScheduledTasks = 0;
}

/**
 * Top level promise that represents the entry point for deferred work.
 * Subsequent promises are chained off this promise, successively composing
 * them together to approximate when painting has occurred.
 *
 * @public
 */
export function didTransition(): Promise<any>  {
  return _didTransition.promise;
}

/**
 * This promise, when resolved, approximates after the route is first painted.
 * This can be used to schedule work to occur that is lower priority than initial
 * work (content outside of the viewport, rendering non-critical content).
 *
 * @public
 */
export function whenRoutePainted(): Promise<any> {
  return _whenRoutePainted;
}

/**
 * This promise, when resolved, approximates after content is painted.
 *
 * @public
 */
export function whenRouteIdle(): Promise<any>  {
  return _whenRouteIdle;
}

/**
 * Used for testing
 */
export function routeSettled(): Promise<any>  {
  return _whenRouteIdle;
}

export function _getScheduleFn(useRequestIdleCallback = false) {
  if (useRequestIdleCallback && _capabilities.requestIdleCallbackEnabled) {
    return requestIdleCallback;
  } else if (_capabilities.requestAnimationFrameEnabled) {
    return requestAnimationFrame;
  } else {
    return SIMPLE_CALLBACK;
  }
}

export function _setCapabilities(newCapabilities = CAPABILITIES) {
  _capabilities = newCapabilities;
}

_whenRoutePaintedScheduleFn = _getScheduleFn();
_whenRouteIdleScheduleFn = _getScheduleFn(USE_REQUEST_IDLE_CALLBACK);

function _afterNextPaint(scheduleFn: Function) {
  let promise = new Promise(resolve => {
    if (DEBUG) {
      _activeScheduledTasks++;
    }

    scheduleFn(() => {
      run.later(resolve, 0);
    });
  });

  if (DEBUG) {
    promise = promise.finally(() => {
      _activeScheduledTasks--;
    });
  }

  return promise;
}

if (DEBUG) {
  // wait until no active rafs
  registerWaiter(() => _activeScheduledTasks === 0);
}

function _defer(label: string): IDeferred {
  let _isResolved = false;
  let _resolve!: () => void;
  let _reject!: () => void;

  const promise = new Promise((resolve, reject) => {
    _resolve = () => {
      _isResolved = true;

      resolve();
    };
    _reject = reject;
  }, label);

  return {
    promise,
    resolve: _resolve,
    reject: _reject,
    get isResolved() {
      return _isResolved;
    }
  };
}
