const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function harness({ platform = 'basalt', initial = {}, now = 1000000 } = {}) {
  const requests = [], messages = [], timers = new Map(), listeners = {};
  let timerId = 0;
  const localStorage = storage(initial);
  class FakeDate extends Date { static now() { return now; } }
  class XMLHttpRequest {
    constructor() { this.headers = {}; requests.push(this); }
    open(method, url, async) { Object.assign(this, { method, url, async }); }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) { this.body = body; }
    respond(status, body = '') {
      this.status = status;
      this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
      this.onload();
    }
    fail() { this.onerror(); }
  }
  const Pebble = {
    getActiveWatchInfo: () => ({ platform }),
    addEventListener: (event, fn) => { listeners[event] = fn; },
    openURL: url => { Pebble.openedURL = url; },
    sendAppMessage: (body, ack, nack) => { messages.push({ body, ack, nack }); }
  };
  const globals = {
    Pebble, localStorage, XMLHttpRequest, Date: FakeDate,
    console: { log() {} },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => { timers.set(++timerId, { fn, delay, interval: true }); return timerId; },
    clearInterval: id => timers.delete(id)
  };
  return {
    ...globals, requests, messages, timers, listeners,
    advanceTime(ms) { now += ms; },
    runTimer() {
      const [id, timer] = timers.entries().next().value;
      if (!timer.interval) timers.delete(id);
      timer.fn();
      return timer.delay;
    },
    load(file, dependencies = {}) {
      const context = vm.createContext({
        ...globals, module: { exports: {} },
        require(name) {
          if (Object.hasOwn(dependencies, name)) return dependencies[name];
          if (name === './settings') {
            const settingsContext = vm.createContext({ ...globals, module: { exports: {} } });
            vm.runInContext(fs.readFileSync(path.join(root, 'src/pkjs/settings.js'), 'utf8'), settingsContext);
            return settingsContext.module.exports;
          }
          // Never read generated credentials or make real network requests.
          throw new Error('Unmocked dependency: ' + name);
        }
      });
      vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
      return context;
    }
  };
}

// Normalize values across vm realms for strict comparisons.
const plain = value => JSON.parse(JSON.stringify(value));
module.exports = { harness, storage, plain, root };
