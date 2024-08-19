/*
Copyright 2024, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.rpi.

com.gruijter.rpi is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.rpi is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.rpi. If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

const { Device } = require('homey');

const util = require('util');
const RPI = require('../../rpi_ssh');

const setTimeoutPromise = util.promisify(setTimeout);

class RPiDevice extends Device {

  async onInit() {
    try {
      // this.setUnavailable('Waiting for connection').catch(() => null);
      await this.destroyListeners();
      this.busy = false;
      this.skipCounter = 0;
      this.watchDogCounter = 15;
      this.lastPollFastTm = 0;
      this.lastPollSlowTm = 0;
      this.lastHourlyPollTm = 0;
      this.settings = { ...this.getSettings() };
      await this.migrate().catch(this.error);
      if (this.rpi) await this.rpi.connect(this.settings);
      if (!this.rpi) this.rpi = new RPI(this.settings);
      // start polling device for info
      const pollingInterval = this.settings.pollingInterval ? this.settings.pollingInterval : this.settings.pollingIntervalSlow; // minimum 1 second, maximum 5 seconds
      this.startPolling(pollingInterval).catch(this.error);
      await this.registerListeners();
      this.log(`${this.getName()} has been initialized`);
    } catch (error) {
      this.error(error);
      // this.setUnavailable(error).catch(() => null);
      this.restartDevice(60 * 1000).catch(this.error);
    }
  }

  async migrate() {
    try {
      this.log(`checking device migration for ${this.getName()}`);
      // store the capability states before migration
      const sym = Object.getOwnPropertySymbols(this).find((s) => String(s) === 'Symbol(state)');
      const state = this[sym];
      // check and repair incorrect capability(order)
      let capsChanged = false;
      const correctCaps = this.driver.ds.capabilities;
      for (let index = 0; index < correctCaps.length; index += 1) {
        const caps = this.getCapabilities();
        const newCap = correctCaps[index];
        if (caps[index] !== newCap) {
          this.setUnavailable('Device is migrating. Please wait!').catch(this.error);
          capsChanged = true;
          // remove all caps from here
          for (let i = index; i < caps.length; i += 1) {
            this.log(`removing capability ${caps[i]} for ${this.getName()}`);
            await this.removeCapability(caps[i])
              .catch((error) => this.log(error));
            await setTimeoutPromise(2 * 1000); // wait a bit for Homey to settle
          }
          // add the new cap
          this.log(`adding capability ${newCap} for ${this.getName()}`);
          await this.addCapability(newCap);
          // restore capability state
          if (state[newCap]) this.log(`${this.getName()} restoring value ${newCap} to ${state[newCap]}`);
          // else this.log(`${this.getName()} has gotten a new capability ${newCap}!`);
          if (state[newCap] !== undefined) this.setCapability(newCap, state[newCap]).catch(this.error);
          await setTimeoutPromise(2 * 1000); // wait a bit for Homey to settle
        }
      }
      if (capsChanged) this.restartDevice(1 * 1000).catch(this.error);
    } catch (error) {
      this.error(error);
    }
  }

  async onUninit() {
    this.log('Device unInit', this.getName());
    await this.destroyListeners();
    // await setTimeoutPromise(5000); // wait 5 secs
  }

  async onAdded() {
    this.log(`${this.getName()} has been added`);
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log(`${this.getName()} settings where changed`, newSettings);
    this.restartDevice(3 * 1000).catch(this.error);
  }

  async onDeleted() {
    await this.destroyListeners();
    this.log('Device deleted', this.getName());
  }

  async startPolling(interval) {
    this.homey.clearInterval(this.intervalIdPoll);
    this.log(`start polling ${this.getName()} @${interval} seconds interval`);
    await this.doPoll().catch(this.error);
    this.intervalIdPoll = this.homey.setInterval(() => {
      this.doPoll().catch(this.error);
    }, 1000); // interval * 1000); > try every second
  }

  async stopPolling() {
    this.log(`Stop polling ${this.getName()}`);
    this.homey.clearInterval(this.intervalIdPoll);
  }

  async restartDevice(delay) {
    try {
      if (this.restarting) return;
      this.restarting = true;
      await this.stopPolling();
      // this.destroyListeners();
      const dly = delay || 2000;
      this.log(`Device will restart in ${dly / 1000} seconds`);
      // await this.setUnavailable('Device is restarting. Wait a few minutes!');
      await setTimeoutPromise(dly);
      this.restarting = false;
      this.onInit().catch(this.error);
    } catch (error) {
      this.error(error);
    }
  }

  async doPoll() {
    try {
      if (this.watchDogCounter <= 0) {
        this.log('watchdog triggered, restarting Homey device now');
        this.setUnavailable(this.homey.__('device.connectionError')).catch(() => null);
        this.restartDevice(60 * 1000).catch(this.error);
        return;
      }
      // check if any poll needs to be done this second
      const now = Date.now();
      const doFastPoll = this.settings.pollingInterval && ((now - this.lastPollFastTm) >= (this.settings.pollingInterval * 1000));
      const doSlowPoll = (now - this.lastPollSlowTm) >= (this.settings.pollingIntervalSlow * 1000);
      const doHourlyPoll = (now - this.lastHourlyPollTm) > 1000 * 60 * 60;
      if (!doFastPoll && !doSlowPoll) return;
      if (this.busy) {
        this.watchDogCounter -= 1;
        this.skipCounter += 1;
        if (this.skipCounter > 1) this.log(`${this.getName()} skipping multiple polls`, this.skipCounter, this.watchDogCounter);
        return;
      }
      this.busy = true;
      this.skipCounter = 0;
      if (doSlowPoll) {
        // get new status and update the devicestate
        const stats = await this.rpi.getStats();
        await this.updateDeviceState(stats);
        // get user log and trigger flow
        const newLogs = await this.rpi.getLastLogin().catch(() => null);
        if (newLogs) await this.updateLogTrigger(newLogs);
        this.lastPollSlowTm = now;
      }
      if (doFastPoll) {
        const gpio = await this.rpi.getGPIOStates();
        await this.updateGpioState(gpio);
        this.lastPollFastTm = now;
      }
      if (doHourlyPoll) {
        const sysInfo = await this.rpi.getSysInfo();
        await this.updateSysInfo(sysInfo);
        this.lastHourlyPollTm = now;
      }
      this.setAvailable().catch(() => null);
      this.watchDogCounter = 15;
      this.busy = false;
    } catch (error) {
      this.watchDogCounter -= 1;
      this.busy = false;
      this.error('Poll error', error.message);
    }
  }

  async setCapability(capability, value) {
    if (this.hasCapability(capability) && value !== undefined) {
      await this.setCapabilityValue(capability, value)
        .catch((error) => {
          this.log(error, capability, value);
        });
    }
  }

  calculateSpeed(newstats, oldstats) {
    try {
      if (!oldstats) return {};
      // calculate speeds
      const deltaTime = (newstats.timestamp - oldstats.timestamp); // milliseconds
      let dseth = Math.round((8 * (newstats.ETH0Traffic.rxBytes - oldstats.ETH0Traffic.rxBytes)) / deltaTime) / 1000;
      let useth = Math.round((8 * (newstats.ETH0Traffic.txBytes - oldstats.ETH0Traffic.txBytes)) / deltaTime) / 1000;
      let dswlan = Math.round((8 * (newstats.WLAN0Traffic.rxBytes - oldstats.WLAN0Traffic.rxBytes)) / deltaTime) / 1000;
      let uswlan = Math.round((8 * (newstats.WLAN0Traffic.txBytes - oldstats.WLAN0Traffic.txBytes)) / deltaTime) / 1000;
      dseth = dseth < 0 ? 0 : dseth;
      useth = useth < 0 ? 0 : useth;
      dswlan = dswlan < 0 ? 0 : dswlan;
      uswlan = uswlan < 0 ? 0 : uswlan;
      return {
        dseth, useth, dswlan, uswlan,
      };
    } catch (error) {
      this.error(error);
      return {};
    }
  }

  async updateSysInfo(sysInfo) {
    const currentSettings = { ...this.getSettings() };
    const newSysInfo = Object.fromEntries(Object.entries(sysInfo).map(([key, value]) => [key, String(value)]));
    let sysInfoChanged = false;
    Object.entries(newSysInfo).forEach((entry) => {
      if (currentSettings[entry[0]] && (currentSettings[entry[0]] !== entry[1].toString())) {
        this.log(`${this.getName()} updating sysInfo`, entry[0], entry[1].toString());
        sysInfoChanged = true;
      }
    });
    if (sysInfoChanged) this.setSettings(newSysInfo).catch(this.error);
  }

  async updateGpioState(gpio) {
    try {
      // add GPIO capability states for first 16 GPIO
      const capabilityStates = {};
      for (const [key, value] of Object.entries(gpio)) {
        if (Number(key) < 16) capabilityStates[`onoff.gpio${key}`] = value.level;
      }
      // set the capabilities
      Object.entries(capabilityStates).forEach((entry) => {
        this.setCapability(entry[0], entry[1]).catch(this.error);
      });
      // triggger GPIO flows on change
      if (this.lastGpio) {
        for (const [key, value] of Object.entries(gpio)) {
          if (value && this.lastGpio[key] && (value.level !== this.lastGpio[key].level)) {
            const drive = value.level ? 'dh' : 'dl';
            const state = { io: Number(key) };
            // console.log(`${this.getName()} GPIO${key} changed to ${drive}`);
            if (drive === 'dh') {
              this.homey.app.triggerGpioHigh(this, {}, state);
            } else {
              this.homey.app.triggerGpioLow(this, {}, state);
            }
          }
        }
      }
      // save last GPIO states
      this.lastGpio = { ...gpio };
    } catch (error) {
      this.error(error);
    }
  }

  async updateDeviceState(stats) {
    try {
      // calculate network speeds
      const speeds = this.calculateSpeed(stats, this.lastStats);
      const capabilityStates = {
        'measure_temperature.gpu': stats.gpuTemp,
        'measure_temperature.cpu': stats.cpuTemp,
        meter_cpu_utilization: stats.cpuUsage,
        meter_cpu_scaling: stats.cpuScaling,
        meter_mem_utilization: stats.memUsage,
        meter_storage_utilization: stats.storageUsage,
        'meter_processes.active': stats.activeProcesses,
        'meter_processes.running': stats.runningProcesses,
        uptime: stats.uptime,
        meter_users: stats.users,
        'meter_download_speed.eth0': speeds.dseth,
        'meter_upload_speed.eth0': speeds.useth,
        'meter_download_speed.wlan0': speeds.dswlan,
        'meter_upload_speed.wlan0': speeds.uswlan,
      };
      // set the capabilities
      Object.entries(capabilityStates).forEach((entry) => {
        this.setCapability(entry[0], entry[1]).catch(this.error);
      });
      // save last stats
      this.lastStats = { ...stats };
    } catch (error) {
      this.error(error);
    }
  }

  // trigger flows
  async updateLogTrigger(newLogs) {
    try {
      const { newUsers, goneUsers } = await this.rpi.findLogsDelta(newLogs);
      newUsers.forEach((user) => {
        // trigger new user card
        this.log('user login:', user);
        this.homey.app.triggerUserLogin(this, user);
      });
      goneUsers.forEach((user) => {
        // trigger gone user card
        this.log('user logout:', user);
        this.homey.app.triggerUserLogout(this, user);
      });
    } catch (error) {
      this.error(error);
    }
  }

  // condition flow card helpers
  async gpioIsHigh(args) {
    if (!this.lastGpio || !this.lastGpio[args.io]) throw Error('GPIO state unkown');
    return this.lastGpio[args.io].level;
  }

  // commands to rpi
  async executeCommand(args, source) {
    try {
      if (!this.rpi) throw Error('Rpi not ready');
      this.log(`${this.getName()} Executing ${args.command} by ${source}`);
      const resp = await this.rpi.execute(args.command);
      const tokens = { response: JSON.stringify(resp) };
      return tokens;
    } catch (error) {
      this.error(`${this.getName()}`, error && error.message);
      return Promise.reject(error);
    }
  }

  async setGpioOutput(args, source) {
    try {
      if (!this.rpi) throw Error('Rpi not ready');
      this.log(`${this.getName()} Setting GPIO${args.io} to ${args.high} by ${source}`);
      await this.rpi.setGPIOState(args); // { io: 5, high: true }
      return true;
    } catch (error) {
      this.error(`${this.getName()}`, error && error.message);
      return Promise.reject(error);
    }
  }

  async update(args, source) {
    try {
      if (!this.rpi) throw Error('Rpi not ready');
      this.log(`${this.getName()} update command sent by ${source}`);
      await this.rpi.update();
      return true;
    } catch (error) {
      this.error(`${this.getName()}`, error && error.message);
      return Promise.reject(error);
    }
  }

  async reboot(args, source) {
    try {
      if (!this.rpi) throw Error('Rpi not ready');
      this.log(`${this.getName()} reboot command sent by ${source}`);
      await this.rpi.reboot();
      return true;
    } catch (error) {
      this.error(`${this.getName()}`, error && error.message);
      return Promise.reject(error);
    }
  }

  async poweroff(args, source) {
    try {
      if (!this.rpi) throw Error('Rpi not ready');
      this.log(`${this.getName()} poweroff command sent by ${source}`);
      await this.rpi.poweroff();
      return true;
    } catch (error) {
      this.error(`${this.getName()}`, error && error.message);
      return Promise.reject(error);
    }
  }

  // Docker flow stuff
  async getContainers(args, source) {
    try {
      if (!this.rpi) throw Error('Rpi not ready');
      if (source === 'flow') this.log(`${this.getName()} listing Docker containers by ${source}`);
      const containers = await this.rpi.getContainers();
      return Promise.resolve(containers);
    } catch (error) {
      this.error(`${this.getName()}`, error && error.message);
      return Promise.reject(error);
    }
  }

  async stopContainer(args, source) {
    try {
      if (!this.rpi) throw Error('Rpi not ready');
      this.log(`${this.getName()} stop Docker container ${args.id.name} from ${source}`);
      await this.rpi.stopContainer(args.id.name);
      return Promise.resolve(true);
    } catch (error) {
      this.error(`${this.getName()}`, error && error.message);
      return Promise.reject(error);
    }
  }

  async startContainer(args, source) {
    try {
      if (!this.rpi) throw Error('Rpi not ready');
      this.log(`${this.getName()} start Docker container ${args.id.name} from ${source}`);
      await this.rpi.startContainer(args.id.name);
      return Promise.resolve(true);
    } catch (error) {
      this.error(`${this.getName()}`, error && error.message);
      return Promise.reject(error);
    }
  }

  async restartContainer(args, source) {
    try {
      if (!this.rpi) throw Error('Rpi not ready');
      this.log(`${this.getName()} restart Docker container ${args.id.name} from ${source}`);
      await this.rpi.restartContainer(args.id.name);
      return Promise.resolve(true);
    } catch (error) {
      this.error(`${this.getName()}`, error && error.message);
      return Promise.reject(error);
    }
  }

  // homey device listeners
  async registerListeners() {
    if (this.listenersSet) return;
    // GPIO button onoff listener
    for (let idx = 0; idx < 16; idx++) {
      this.registerCapabilityListener(`onoff.gpio${idx}`, async (value) => {
        await this.setGpioOutput({ io: idx, high: value }, 'user app');
      });
    }
    this.listenersSet = true;
    this.log(`${this.getName()} ready setting up listeners`);
  }

  // remove listeners NEEDS TO BE ADAPTED
  async destroyListeners() {
    try {
      this.log('removing listeners', this.getName());
      if (this.rpi) await this.rpi.disconnect();
      // this.homey.removeAllListeners('......');
    } catch (error) {
      this.error(error);
    }
  }

}

module.exports = RPiDevice;
