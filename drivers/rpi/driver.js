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

const { Driver } = require('homey');
const RPI = require('../../rpi_ssh');

const capabilities = [
  'measure_temperature.gpu',
  'measure_temperature.cpu',
  'meter_cpu_utilization',
  'meter_cpu_scaling',
  'meter_mem_utilization',
  'meter_storage_utilization',
  'meter_processes.active',
  'meter_processes.running',
  'uptime',
  'meter_users',
  'meter_download_speed.eth0',
  'meter_upload_speed.eth0',
  'meter_download_speed.wlan0',
  'meter_upload_speed.wlan0',
  'onoff.gpio0',
  'onoff.gpio1',
  'onoff.gpio2',
  'onoff.gpio3',
  'onoff.gpio4',
  'onoff.gpio5',
  'onoff.gpio6',
  'onoff.gpio7',
  'onoff.gpio8',
  'onoff.gpio9',
  'onoff.gpio10',
  'onoff.gpio11',
  'onoff.gpio12',
  'onoff.gpio13',
  'onoff.gpio14',
  'onoff.gpio15',
];

class RPiDriver extends Driver {

  async onInit() {
    this.ds = { capabilities };
    this.log('RPi driver has been initialized');
  }

  // // MAC discovery related stuff
  // async discover() {
  //   const discoveryStrategy = this.getDiscoveryStrategy();
  //   const discoveryResults = await discoveryStrategy.getDiscoveryResults();
  //   console.dir(discoveryResults, { depth: null });
  // }

  async onPair(session) {
    let discovered = [];

    session.setHandler('manual_login', async (conSett) => {
      try {
        this.log(conSett);
        const settings = { ...conSett };
        const rpi = new RPI(settings);
        // check credentials and get status info
        await rpi.connect();
        const sysInfo = await rpi.getSysInfo();
        Object.entries(sysInfo).forEach((entry) => {
          settings[entry[0]] = entry[1].toString();
        });
        const device = {
          name: `${sysInfo.hostName}`,
          data: {
            id: sysInfo.serial,
          },
          capabilities,
          settings,
          // piName: sysInfo.hostName,
          // username: settings.username,
          // password: settings.password,
          // host: settings.host,
          // port: settings.port,
          // model: sysInfo.model,
          // revision: sysInfo.revision,
          // sn: sysInfo.serial,
          // processors: sysInfo.processors,
          // osArch: sysInfo.osArch,
          // osName: sysInfo.osName,
          // osVersion: sysInfo.osVersion,
        };
        discovered = [device];
        return Promise.resolve(discovered);
      } catch (error) {
        this.error(error);
        return Promise.reject(error);
      }
    });

    session.setHandler('list_devices', async () => {
      try {
        const devices = discovered;
        return Promise.resolve(devices);
      } catch (error) {
        this.error(error);
        return Promise.reject(error);
      }
    });
  }

}

module.exports = RPiDriver;
