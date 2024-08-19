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

const { NodeSSH } = require('node-ssh');

// const util = require('util');

// const setTimeoutPromise = util.promisify(setTimeout);

const defaultPort = 22;
const defaultTimeout = 10000;

// used for system info
const getCPUInfo = 'cat /proc/cpuinfo'; // Raspberry Pi 4 Model B Rev 1.1
const getOSInfo = 'cat /etc/os-release'; // Debian GNU/Linux 12 (bookworm)
const getOSArch = 'uname -m'; // 'aarch64'
const getHostName = 'uname -n'; // 'rpi4'

// used for stats
const getUptime = 'uptime'; // '14:03:55 up 58 min,  2 users,  load average: 0.17, 0.14, 0.15'
const getBootDate = 'uptime -s'; // '2024-08-03 13:05:26'
const getWLAN0Info = '/sbin/ifconfig wlan0';
const getETH0Info = '/sbin/ifconfig eth0';
const getGPUTemp = 'vcgencmd measure_temp'; // "temp=50.1'C"
const getCPUTemp = 'cat /sys/class/thermal/thermal_zone0/temp'; // '51608' => need to divide by 1000
const getCPUCurFreq = 'cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq'; // 600000
const getCPUMaxFreq = 'cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq'; // 1500000
const getMemoryStats = 'free';
const getRootStorageInfo = 'df /';
const getProcesses = 'ps ax';

// used for user sessions
const getUsers = 'w';
const getLastLogin = 'last -10 --time-format iso'; // get last logged in/out users

// used for OS commands
const reboot = 'sudo systemctl reboot';
const poweroff = 'sudo systemctl poweroff';
const update = 'sudo apt-get update && sudo apt-get upgrade -y';

// used for GPIO
const getGPIOStates = 'raspi-gpio get';
const setGPIOState = 'raspi-gpio set';

// used for docker
const getContainers = 'sudo docker ps -a';
const stopContainer = 'sudo docker stop '; // add container name or id
const startContainer = 'sudo docker start '; // add container name or id
const restartContainer = 'sudo docker restart '; // add container name or id

// alternatives for non-Rasberry OS
// const getThermalZones = 'cat /sys/class/thermal/thermal_zone*/type';
// const getZoneTemps = 'cat /sys/class/thermal/thermal_zone*/temp';
// const getCPUTempDDWRT = 'cat /proc/dmu/temperature'; // '516' => need to divide by 10
// const getVmstat = 'vmstat'; // CPU Usage = 100 - idle (column 15)

// Represents a SSH session to a remote server.
class RPi {

  constructor(opts) {
    const options = opts || {};
    this.username = options.username;
    this.password = options.password;
    this.host = options.host;
    this.port = options.port || defaultPort;
    this.timeout = options.timeout || defaultTimeout;
    this.sshClient = new NodeSSH(); // Create a new SSH client instance
    this.connected = false;
    this.lastResponse = undefined;
    // process.on('warning', e => console.warn(e.stack));
  }

  async connect(opts) {
    try {
      const options = opts || {};
      const host = options.host || this.host;
      const port = options.port || this.port;
      const username = options.username || this.username;
      const password = options.password || this.password;
      const timeout = options.timeout || this.timeout;
      this.host = host;
      this.port = port;
      this.username = username;
      this.password = password;
      this.timeout = timeout;
      // Connect to the SSH server
      const connectionParams = {
        host,
        port,
        readyTimeout: defaultTimeout,
        timeout: defaultTimeout,
        username,
        password,
        // privateKey: require('fs').readFileSync('/path/to/your/private-key')
        // debug: (d) => console.log(d),
      };
      await this.disconnect();
      if (!this.sshClient) this.sshClient = new NodeSSH();
      await this.sshClient.connect(connectionParams);
      this.connected = true;
      return Promise.resolve(true);
    } catch (error) {
      // console.log('failed to connect', error);
      this.connected = false;
      return Promise.reject(error);
    }
  }

  async disconnect() {
    if (this.sshClient) this.sshClient.dispose();
    this.connected = false;
  }

  // Execute a command on the remote server
  async execute(command) {
    try {
      if (!this.connected || !this.sshClient || !this.sshClient.isConnected()) await this.connect();
      const result = await this.sshClient.execCommand(command); // { code: 0, signal: null, stdout: '', stderr: '' }
      this.lastResponse = result;
      if (result.code !== 0) throw Error(result.stderr + result.stdout);
      return Promise.resolve(result.stdout);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // Execute a command on the remote server without error return, except connection errors
  async silentExec(command) {
    try {
      const result = await this.execute(command);
      return Promise.resolve(result);
    } catch (error) {
      if (!this.connected) return Promise.reject(error);
      return Promise.resolve(null);
    }
  }

  // get host system info
  async getSysInfo() {
    try {
      const hostName = await this.silentExec(getHostName);
      const osArch = await this.silentExec(getOSArch);

      let processors;
      let revision;
      let serial;
      let model;
      const cpuInfo = await this.silentExec(getCPUInfo);
      if (cpuInfo) {
        processors = (cpuInfo.match(/processor\s+:/g) || []).length;
        const revisionMatch = cpuInfo.match(/Revision\s+:\s+([^\n]+)/);
        revision = revisionMatch ? revisionMatch[1].trim() : null;
        const serialMatch = cpuInfo.match(/Serial\s+:\s+([^\n]+)/);
        serial = serialMatch ? serialMatch[1].trim() : null;
        const modelMatch = cpuInfo.match(/Model\s+:\s+([^\n]+)/);
        model = modelMatch ? modelMatch[1].trim() : null;
      }

      const cpuMaxFreq = await this.silentExec(getCPUMaxFreq);

      let osName;
      let osVersion;
      const osInfo = await this.silentExec(getOSInfo);
      if (osInfo) {
        const nameMatch = osInfo.match(/^NAME="([^"]+)"/m);
        osName = nameMatch ? nameMatch[1].trim() : null;
        const versionMatch = osInfo.match(/VERSION="([^"]+)"/);
        osVersion = versionMatch ? versionMatch[1].trim() : null;
      }

      const sysInfo = {
        hostName,
        model,
        revision,
        serial,
        processors,
        cpuMaxFreq,
        osArch,
        osName,
        osVersion,
      };
      this.sysInfo = sysInfo;
      return Promise.resolve(sysInfo);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // helper to find lastLogin delta
  findLogsDelta(newLogs, oldLogsXXX) {
    if (!newLogs) throw Error('newLogs missing');
    const { oldLogs } = this;
    let newUsers = [];
    let goneUsers = [];
    try {
      if (!oldLogs) {
        this.oldLogs = [...newLogs];
        return { newUsers, goneUsers };
      }
      // find new logins
      const newLoggedInNow = newLogs.filter((logNew) => !logNew.logoutTime && !logNew.info.includes('gone')); // still logged in
      let oldLoggedInNow = oldLogs.filter((logOld) => !logOld.logoutTime && !logOld.info.includes('gone')); // still logged in

      newUsers = newLoggedInNow.filter((newLog) => {
        const match = oldLoggedInNow.find((oldLog) => oldLog.loginTime === newLog.loginTime);
        return !match;
      });

      if (newUsers.length) {
        oldLoggedInNow = oldLogs.slice(0, -newUsers.length).filter((logOld) => !logOld.logoutTime && !logOld.info.includes('gone'));
      }

      goneUsers = oldLoggedInNow
        .filter((oldLog) => {
          const match = newLoggedInNow.find((newLog) => oldLog.loginTime === newLog.loginTime);
          return !match;
        })
        .map((oldLog) => {
          let goneLog = newLogs.find((newLog) => oldLog.loginTime === newLog.loginTime);
          if (!goneLog) goneLog = oldLog;
          return goneLog;
        });

      this.oldLogs = [...newLogs];
      return Promise.resolve({ newUsers, goneUsers });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // get last Login/Out
  async getLastLogin() {
    try {
      let lastLogin = [];
      const lastLoginRaw = await this.silentExec(getLastLogin);
      if (lastLoginRaw) {
        const parseLine = (line) => {
          // eslint-disable-next-line max-len
          const regex = /(\w+)\s+(pts\/\d+|\s{3,})\s+(\d+\.\d+\.\d+\.\d+|\s{3,})\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+\d{2}:\d{2})(?:\s+-\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+\d{2}:\d{2})\s+\((\d{2}:\d{2})\))?(.*)/;
          const match = line.match(regex);
          if (!match) return null;
          return {
            user: match[1].trim(),
            tty: match[2].trim() || '',
            host: match[3].trim() || '',
            loginTime: match[4],
            logoutTime: match[5] || '',
            duration: match[6] || '',
            info: match[7].trim(),
          };
        };
        const lines = lastLoginRaw.split('\n');
        lastLogin = lines.map(parseLine).filter(Boolean);
      }
      return Promise.all(lastLogin);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // get active user sessions
  async getUsers() {
    try {
      let userArray = [];
      const userInfo = await this.silentExec(getUsers);
      if (userInfo) {
        const lines = userInfo.trim().split('\n');
        const headerLineIndex = lines.findIndex((line) => line.startsWith('USER'));
        const headerLineItems = lines[headerLineIndex].trim().replace('@', '').split(/\s+/);
        const userLines = lines.slice(headerLineIndex + 1);
        userArray = userLines.map((line) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length < headerLineItems.length) parts.splice(1, 0, '-');
          const user = {};
          headerLineItems.forEach((header, idx) => {
            user[header] = parts[idx];
          });
          return user;
        });
      }
      return Promise.all(userArray);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // get various realtime statistics
  async getStats() {
    try {
      if (!this.sysInfo) await this.getSysInfo();

      let bootDate = await this.silentExec(getBootDate);
      if (bootDate) bootDate = new Date(bootDate);

      let uptime;
      let users;
      let loadAvg;
      let cpuUsage;
      const uptimeRaw = await this.silentExec(getUptime);
      if (uptimeRaw) {
        const match = uptimeRaw.match(/up\s+((\d+\s+days?,\s+)?(\d+:\d+|\d+\s+min)),\s+(\d+)\s+users?,\s+load\s+average:\s+(\d+\.\d+)/);
        if (match) {
          uptime = match[1].trim();
          users = parseInt(match[4], 10);
          loadAvg = parseFloat(match[5]);
        }
        if (loadAvg && this.sysInfo.processors) {
          cpuUsage = 100 * (loadAvg / this.sysInfo.processors);
          if (cpuUsage > 100) cpuUsage = 100;
        }
      }

      let lastLogins = [];
      const lastLoginRaw = await this.silentExec(getLastLogin);
      if (lastLoginRaw) lastLogins = lastLoginRaw;

      // const vmstat = await this.silentExec(getVmstat);
      // let cpuUsage;
      // if (vmstat) {
      //   const cpuLine = vmstat.split('\n')[2].trim().split(/\s+/);
      //   cpuUsage = 100 - parseFloat(cpuLine[14]);
      // }

      let cpuTemp = await this.silentExec(getCPUTemp);
      if (cpuTemp) cpuTemp /= 1000;

      let gpuTemp = await this.silentExec(getGPUTemp);
      if (gpuTemp) {
        gpuTemp = gpuTemp.match(/[-+]?\d*\.?\d+/);
        if (gpuTemp) gpuTemp = Number(gpuTemp[0]);
      }

      const { cpuMaxFreq } = this.sysInfo;
      const cpuCurFreq = await this.silentExec(getCPUCurFreq);
      let cpuScaling;
      if (cpuCurFreq && cpuMaxFreq) cpuScaling = Math.round(100 * (Number(cpuCurFreq) / Number(cpuMaxFreq)));

      let memUsage;
      const memstat = await this.silentExec(getMemoryStats);
      if (memstat) {
        const memLine = memstat.trim().split('\n')[1].trim().split(/\s+/);
        const totalMemory = parseInt(memLine[1], 10);
        const availableMemory = parseInt(memLine[6], 10);
        memUsage = Math.round(100 - (availableMemory / totalMemory) * 100);
      }

      let storageUsage;
      const rootStorageInfo = await this.silentExec(getRootStorageInfo);
      if (rootStorageInfo) {
        const dataLine = rootStorageInfo.trim().split('\n')[1].trim().split(/\s+/);
        storageUsage = parseInt(dataLine[4].replace('%', ''), 10);
      }

      let totalProcesses;
      let activeProcesses;
      let runningProcesses;
      const processes = await this.silentExec(getProcesses);
      if (processes) {
        const lines = processes.trim().split('\n');
        const processLines = lines.slice(1);
        totalProcesses = processLines.length;
        activeProcesses = 0;
        runningProcesses = 0;
        processLines.forEach((line) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length > 2) {
            const stat = parts[2];
            // Check if the STAT indicates an active process (Running or Sleeping)
            if (stat.startsWith('R')) {
              runningProcesses += 1;
              activeProcesses += 1;
            }
            if (stat.startsWith('S')) {
              activeProcesses += 1;
            }
          }
        });
      }

      const WLAN0Traffic = { rxBytes: 0, txBytes: 0 };
      const wlanInfo = await this.silentExec(getWLAN0Info);
      if (wlanInfo) {
        WLAN0Traffic.rxBytes = parseInt(wlanInfo.match(/RX\s+(?:packets\s+\d+\s+)?bytes[:\s]+(\d+)/)[1], 10);
        WLAN0Traffic.txBytes = parseInt(wlanInfo.match(/TX\s+(?:packets\s+\d+\s+)?bytes[:\s]+(\d+)/)[1], 10);
      }

      const ETH0Traffic = { rxBytes: 0, txBytes: 0 };
      const ethInfo = await this.silentExec(getETH0Info);
      if (ethInfo) {
        ETH0Traffic.rxBytes = parseInt(ethInfo.match(/RX\s+(?:packets\s+\d+\s+)?bytes[:\s]+(\d+)/)[1], 10);
        ETH0Traffic.txBytes = parseInt(ethInfo.match(/TX\s+(?:packets\s+\d+\s+)?bytes[:\s]+(\d+)/)[1], 10);
      }

      const timestamp = new Date();

      const stats = {
        bootDate,
        uptime,
        users,
        lastLogins,
        loadAvg,
        gpuTemp,
        cpuTemp,
        cpuUsage,
        cpuScaling,
        memUsage,
        storageUsage,
        totalProcesses,
        activeProcesses,
        runningProcesses,
        ETH0Traffic,
        WLAN0Traffic,
        timestamp,
      };
      return Promise.resolve(stats);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // get GPIO states
  async getGPIOStates() {
    try {
      const gpioStates = {};
      const gpioStatesRaw = await this.silentExec(getGPIOStates);
      if (gpioStatesRaw) {
        // const regex = /GPIO (\d+): level=(\d) func=(\w+) pull=(\w+)/g;
        // const regex = /GPIO (\d+): level=(\d) fsel=(\d)(?: alt=(\d))? func=(\w+)(?: pull=(\w+))?/g;
        const regex = /GPIO (\d+): level=(\d)(?: fsel=(\d+))?(?: alt=(\d+))? func=(\w+)(?: pull=(\w+))?/g;
        let match;
        // eslint-disable-next-line no-cond-assign
        while ((match = regex.exec(gpioStatesRaw)) !== null) {
          const gpioNumber = parseInt(match[1], 10);
          const level = match[2] === '1';
          const fsel = parseInt(match[3], 10);
          const alt = match[4] ? parseInt(match[4], 10) : null;
          const func = match[5];
          const pull = match[6] || null;
          gpioStates[gpioNumber] = {
            level,
            func,
            alt,
            fsel,
            pull,
          };
        }
      }
      return Promise.resolve(gpioStates);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async update() {
    try {
      await this.execute(update);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async poweroff() {
    try {
      await this.execute(poweroff);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async reboot() {
    try {
      await this.execute(reboot);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // set a GPIO output { io: number , high: boolean}
  async setGPIOState(set) {
    try {
      const drive = set.high ? 'dh' : 'dl';
      await this.execute(`${setGPIOState} ${set.io} ${drive}`);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // docker get containerInfo
  async getContainers() {
    try {
      let containerInfo = [];
      const infoRaw = await this.silentExec(getContainers);
      if (infoRaw) {
        const lines = infoRaw.trim().split('\n');
        const headers = lines[0].split(/\s{2,}/);
        containerInfo = lines.slice(1).map((line) => {
          const values = line.split(/\s{2,}/);
          return headers.reduce((obj, header, index) => {
            obj[header.trim()] = values[index].trim();
            return obj;
          }, {});
        });
      }
      return Promise.all(containerInfo);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // docker stop container
  async stopContainer(id) {
    try {
      await this.execute(stopContainer + id);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // docker start container
  async startContainer(id) {
    try {
      await this.execute(startContainer + id);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // docker restart container
  async restartContainer(id) {
    try {
      await this.execute(restartContainer + id);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

}

module.exports = RPi;

/*
sysInfo:
{
  hostName: 'rpi4',
  model: 'Raspberry Pi 4 Model B Rev 1.1',
  revision: 'b03111',
  serial: '1000000003a833d2',
  processors: 4,
  cpuMaxFreq: '1500000',
  osArch: 'aarch64',
  osName: 'Debian GNU/Linux',
  osVersion: '12 (bookworm)'
}

getStats:
{
  bootDate: 2024-08-05T10:07:42.000Z,
  uptime: '1 day, 17 min',
  users: 1,
  loadAvg: 0.21,
  gpuTemp: 44.4,
  cpuTemp: 44.388,
  cpuUsage: 21,
  cpuScaling: 100,
  memUsage: 19,
  storageUsage: 8,
  totalProcesses: 78,
  activeProcesses: 48,
  runningProcesses: 1,
  ETH0Traffic: { rxBytes: 0, txBytes: 0 },
  WLAN0Traffic: { rxBytes: 51140057, txBytes: 112483994 },
  timestamp: 2024-08-06T11:25:06.926Z
}

getLastLogin:
[
  {
    user: 'pi',
    tty: null,
    host: null,
    loginTime: '2024-08-06T11:52:42+02:00',
    logoutTime: null,
    duration: null,
    info: 'still logged in'                    >> = 'LOGIN' VIA VNC (tty = null)
  },
  {
    user: 'pi',
    tty: null,
    host: null,
    loginTime: '2024-08-06T11:10:36+02:00',
    logoutTime: null,
    duration: null,
    info: 'gone - no logout'                    >> = 'LOGOUT' VIA VNC (tty = null)
  },
  {
    user: 'pi',
    tty: 'pts/1',
    host: '10.0.0.36',
    loginTime: '2024-08-06T10:58:14+02:00',
    logoutTime: '2024-08-06T11:06:24+02:00',    >> = LOGOUT VIA SSH (tty = 'pts/..')
    duration: '00:08',
    info: ''
  },
  {
    user: 'pi',
    tty: 'pts/0',
    host: '10.0.0.18',
    loginTime: '2024-08-06T10:52:20+02:00',
    logoutTime: null,
    duration: null,
    info: 'still logged in'                     >> = LOGIN VIA SSH (tty = 'pts/..')
  },
  {
    user: 'pi',
    tty: 'pts/0',
    host: '10.0.0.36',
    loginTime: '2024-08-05T22:13:46+02:00',
    logoutTime: '2024-08-05T22:14:00+02:00',
    duration: '00:00',
    info: ''
  },
  {
  user: 'pi',
  tty: null,
  host: null,
  loginTime: '2024-08-08T10:56:20+02:00',
  logoutTime: null,
  duration: null,
  info: '- down                       (03:49)'      >> = LOGOUT after reboot????
  },
]

getUsers:
[
  {
    USER: 'pi',
    TTY: '-',
    FROM: '-',
    LOGIN: '16:24',
    IDLE: '8:39m',
    JCPU: '6:07',
    PCPU: '2.11s',
    WHAT: '/usr/bin/wayfire'
  },
  {
    USER: 'pi',
    TTY: 'tty1',
    FROM: '-',
    LOGIN: 'Fri23',
    IDLE: '24:32m',
    JCPU: '0.09s',
    PCPU: '0.06s',
    WHAT: '-bash'
  },
  {
    USER: 'pi',
    TTY: 'pts/0',
    FROM: '10.0.0.18',
    LOGIN: '21:44',
    IDLE: '22:34',
    JCPU: '0.16s',
    PCPU: '0.16s',
    WHAT: '-bash'
  }
]

GPIO States:
{
  '0': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '1': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '2': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '3': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '4': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '5': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '6': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '7': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '8': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '9': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '10': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '11': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '12': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '13': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '14': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'NONE' },
  '15': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '16': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '17': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '18': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '19': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '20': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '21': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '22': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '23': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '24': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '25': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '26': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '27': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '28': { level: true, func: 'RGMII_MDIO', alt: 5, fsel: NaN, pull: 'UP' },
  '29': { level: false, func: 'RGMII_MDC', alt: 5, fsel: NaN, pull: 'DOWN' },
  '30': { level: false, func: 'CTS0', alt: 3, fsel: NaN, pull: 'UP' },
  '31': { level: false, func: 'RTS0', alt: 3, fsel: NaN, pull: 'NONE' },
  '32': { level: true, func: 'TXD0', alt: 3, fsel: NaN, pull: 'NONE' },
  '33': { level: true, func: 'RXD0', alt: 3, fsel: NaN, pull: 'UP' },
  '34': { level: true, func: 'SD1_CLK', alt: 3, fsel: NaN, pull: 'NONE' },
  '35': { level: true, func: 'SD1_CMD', alt: 3, fsel: NaN, pull: 'UP' },
  '36': { level: true, func: 'SD1_DAT0', alt: 3, fsel: NaN, pull: 'UP' },
  '37': { level: true, func: 'SD1_DAT1', alt: 3, fsel: NaN, pull: 'UP' },
  '38': { level: true, func: 'SD1_DAT2', alt: 3, fsel: NaN, pull: 'UP' },
  '39': { level: true, func: 'SD1_DAT3', alt: 3, fsel: NaN, pull: 'UP' },
  '40': { level: false, func: 'PWM1_0', alt: 0, fsel: NaN, pull: 'NONE' },
  '41': { level: false, func: 'PWM1_1', alt: 0, fsel: NaN, pull: 'NONE' },
  '42': { level: false, func: 'OUTPUT', alt: null, fsel: NaN, pull: 'UP' },
  '43': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '44': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '45': { level: true, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '46': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '47': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'UP' },
  '48': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '49': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '50': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '51': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '52': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' },
  '53': { level: false, func: 'INPUT', alt: null, fsel: NaN, pull: 'DOWN' }
}

getContainers:
[
  {
    'CONTAINER ID': 'b1a043344f3d',
    IMAGE: 'lscr.io/linuxserver/qbittorrent:latest',
    COMMAND: '"/init"',
    CREATED: '3 weeks ago',
    STATUS: 'Up 3 hours',
    PORTS: '0.0.0.0:6881->6881/tcp, :::6881->6881/tcp, 0.0.0.0:8888->8888/tcp, 0.0.0.0:6881->6881/udp, :::8888->8888/tcp, :::6881->6881/udp, 8080/tcp',
    NAMES: 'qbittorrent'
  },
  {
    'CONTAINER ID': '41a67e39a573',
    IMAGE: 'portainer/portainer-ce',
    COMMAND: '"/portainer"',
    CREATED: '3 weeks ago',
    STATUS: 'Up 3 hours',
    PORTS: '8000/tcp, 9443/tcp, 0.0.0.0:9000->9000/tcp, :::9000->9000/tcp',
    NAMES: 'portainer'
  }
]

*/
