'use strict';

const Homey = require('homey');
require('./lib/clusters');

module.exports = class FuturehomeLocalApp extends Homey.App {

  async onInit() {
    this.log('Futurehome Local has been initialized');
  }

};
