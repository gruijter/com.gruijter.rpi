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

const Homey = require('homey');

class MyApp extends Homey.App {

  async onInit() {
    this.registerFlowListeners();
    this.log('Rpi app has been initialized');
  }

  registerFlowListeners() {
    // autocomplete helper
    const autoComplete = async (query, args) => {
      try {
        const containerList = await args.device.getContainers(args, 'autocomplete');
        const results = containerList
          .map((container) => ({ description: container['CONTAINER ID'], name: container.NAMES }))
          .filter((result) => { // filter for query on ID and Name
            const nameFound = result.name.toLowerCase().indexOf(query.toLowerCase()) > -1;
            const idFound = result.description.indexOf(query.toLowerCase()) > -1;
            return idFound || nameFound;
          });
        return Promise.resolve(results);
      } catch (error) {
        return Promise.reject(error);
      }
    };

    // trigger cards
    this._userLogin = this.homey.flow.getDeviceTriggerCard('user_login');
    this._userLogin.registerRunListener((args, state) => true);
    this.triggerUserLogin = (device, tokens, state) => {
      this._userLogin
        .trigger(device, tokens, state)
        // .then(console.log(device.getName(), tokens, state))
        .catch(this.error);
    };
    this._userLogout = this.homey.flow.getDeviceTriggerCard('user_logout');
    this._userLogout.registerRunListener((args, state) => true);
    this.triggerUserLogout = (device, tokens, state) => {
      this._userLogout
        .trigger(device, tokens, state)
        // .then(console.log(device.getName(), tokens, state))
        .catch(this.error);
    };

    this._gpioHigh = this.homey.flow.getDeviceTriggerCard('gpio_high');
    this._gpioHigh.registerRunListener((args, state) => args.io === state.io);
    //   {
    //   return (args.io === state.io) && (args.device === state.device);
    // });
    this.triggerGpioHigh = (device, tokens, state) => {
      this._gpioHigh
        .trigger(device, tokens, state)
        // .then(console.log(device.getName(), tokens, state))
        .catch(this.error);
    };
    this._gpioLow = this.homey.flow.getDeviceTriggerCard('gpio_low');
    this._gpioLow.registerRunListener((args, state) => args.io === state.io);
    this.triggerGpioLow = (device, tokens, state) => {
      this._gpioLow
        .trigger(device, tokens, state)
        // .then(console.log(device.getName(), tokens, state))
        .catch(this.error);
    };

    // condition cards
    const gpioIsHigh = this.homey.flow.getConditionCard('gpio_is_high');
    gpioIsHigh.registerRunListener((args) => args.device.gpioIsHigh(args));

    // action cards
    const poweroff = this.homey.flow.getActionCard('poweroff');
    poweroff
      .registerRunListener((args) => args.device.poweroff(args, 'flow'));

    const reboot = this.homey.flow.getActionCard('reboot');
    reboot
      .registerRunListener((args) => args.device.reboot(args, 'flow'));

    const update = this.homey.flow.getActionCard('update');
    update
      .registerRunListener((args) => args.device.update(args, 'flow'));

    const setGpioOutput = this.homey.flow.getActionCard('set_gpio_output');
    setGpioOutput
      .registerRunListener((args) => args.device.setGpioOutput(args, 'flow'));

    const executeCommand = this.homey.flow.getActionCard('execute_command');
    executeCommand
      .registerRunListener((args) => args.device.executeCommand(args, 'flow'));

    const listContainers = this.homey.flow.getActionCard('list_containers');
    listContainers
      .registerRunListener(async (args) => ({ containers: JSON.stringify(await args.device.getContainers(args, 'flow')) }));

    const stopContainer = this.homey.flow.getActionCard('stop_container');
    stopContainer
      .registerRunListener((args) => args.device.stopContainer(args, 'flow'))
      .registerArgumentAutocompleteListener('id', autoComplete);

    const startContainer = this.homey.flow.getActionCard('start_container');
    startContainer
      .registerRunListener((args) => args.device.startContainer(args, 'flow'))
      .registerArgumentAutocompleteListener('id', autoComplete);

    const restartContainer = this.homey.flow.getActionCard('restart_container');
    restartContainer
      .registerRunListener((args) => args.device.restartContainer(args, 'flow'))
      .registerArgumentAutocompleteListener('id', autoComplete);

    this.log('Ready setting up flow listeners');
  }

}

module.exports = MyApp;
