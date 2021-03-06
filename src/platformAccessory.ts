import { Service, PlatformAccessory, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import moment from 'moment';
import { GriddyResponse, getData, GriddyItem } from './griddy-api';
import { ExampleHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ExamplePlatformAccessory {
  private priceService: Service;
  private intensityService: Service;
  private lowPriceService: Service;
  private latestGriddyData: GriddyResponse | undefined = undefined;
  private history: GriddyItem[] = [];
  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */

  constructor(private readonly platform: ExampleHomebridgePlatform, private readonly accessory: PlatformAccessory) {
    // set accessory information
    this.platform.log.debug('config', this.platform.config);

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // we use a fake light sensor to represent the real-time price in cents
    this.priceService =
      this.accessory.getService(this.platform.Service.LightSensor) ||
      this.accessory.addService(this.platform.Service.LightSensor);
    // intensity is the price as a percentage of the day's range.
    // Low means it's cheap compared to the day's prices.This device turns "on" when the price is high.
    this.intensityService =
      this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);
    // also uses the intensity, but turns on when the price is "low"
    this.lowPriceService =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.priceService.setCharacteristic(this.platform.Characteristic.Name, 'Griddy Price');

    this.intensityService.setCharacteristic(this.platform.Characteristic.Name, 'Griddy High Price');
    this.lowPriceService.setCharacteristic(this.platform.Characteristic.Name, 'Griddy Low Price');

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.priceService
      .getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
      .on('get', this.getLevel.bind(this));

    this.priceService.getCharacteristic(this.platform.Characteristic.StatusActive).on('get', this.getStatus.bind(this));

    this.intensityService
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .on('get', this.getIntensity.bind(this));

    this.intensityService.getCharacteristic(this.platform.Characteristic.On).on('get', this.getIsHigh.bind(this));
    this.lowPriceService.getCharacteristic(this.platform.Characteristic.On).on('get', this.getIsLow.bind(this));

    this.update();
  }

  async update() {
    this.platform.log.debug('running update');
    try {
      this.latestGriddyData = await getData(this.platform.config.zone);
      this.platform.log.debug(`update finished. Next in ${this.latestGriddyData.seconds_until_refresh} seconds`);
      this.platform.log.debug('latest data', this.latestGriddyData.now);
      // this.platform.log.debug(`intensity is ${this.calculateIntensity(this.latestGriddyData)}`);
      this.platform.log.info(
        `Price now ${
          Math.round(this.latestGriddyData.now.price_ckwh * 1000) / 1000
        }, intensity is ${this.calculateIntensity(this.latestGriddyData, this.history)} (low: ${this.calculateLow(
          this.latestGriddyData,
          this.history
        )} high: ${this.calculateHigh(this.latestGriddyData)})`
      );
      if (this.latestGriddyData) {
        // make it clear that we do have price data
        this.priceService.updateCharacteristic(this.platform.Characteristic.StatusActive, true);
        // sets the price on the price service so you can see it in Home
        this.priceService.updateCharacteristic(
          this.platform.Characteristic.CurrentAmbientLightLevel,
          Math.round(this.latestGriddyData.now.price_ckwh * 1000) / 1000
        );
        // sets the intensity
        this.intensityService.updateCharacteristic(
          this.platform.Characteristic.Brightness,
          this.calculateIntensity(this.latestGriddyData, this.history)
        );
        // flips the high price service to on
        this.intensityService.updateCharacteristic(
          this.platform.Characteristic.On,
          this.defineHigh(this.latestGriddyData, this.history)
        );
        // flips the low price service to in
        this.lowPriceService.updateCharacteristic(
          this.platform.Characteristic.On,
          this.defineLow(this.latestGriddyData, this.history)
        );
        setTimeout(async () => this.update(), this.latestGriddyData.seconds_until_refresh * 1000);
        // push to the history to help with intensity calculations
        this.history = [
          // truncate the history to just today's stuff
          ...this.history.filter((item) => moment(item.date_local_tz).isSame(moment(), 'day')),
          this.latestGriddyData.now
        ];
      } else {
        // we don't know anything so set things to off
        this.handleNoData();
      }
    } catch (error) {
      this.platform.log.error('error connecting to Griddy data api');
      this.handleNoData();
    }
  }

  /**
* Handle the "GET" requests from HomeKit
* These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
* 
* GET requests should return as fast as possbile. A long delay here will result in
* HomeKit being unresponsive and a bad user experience in general.
* 
* If your device takes time to respond you should update the status of your device
* asynchronously instead using the `updateCharacteristic` method instead.

* @example
* this.service.updateCharacteristic(this.platform.Characteristic.On, true)
*/
  getStatus(callback: CharacteristicGetCallback) {
    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, this.latestGriddyData ? true : false);
  }

  getLevel(callback: CharacteristicSetCallback) {
    this.latestGriddyData
      ? callback(null, Math.round(this.latestGriddyData.now.price_ckwh * 1000) / 1000)
      : callback(Error('No information available'));
  }

  getIntensity(callback: CharacteristicSetCallback) {
    this.latestGriddyData
      ? callback(null, this.calculateIntensity(this.latestGriddyData, this.history))
      : callback(Error('No information available'));
  }

  getIsHigh(callback: CharacteristicSetCallback) {
    this.latestGriddyData
      ? callback(null, this.defineHigh(this.latestGriddyData, this.history))
      : callback(Error('No information available'));
  }

  getIsLow(callback: CharacteristicSetCallback) {
    this.latestGriddyData
      ? callback(null, this.defineLow(this.latestGriddyData, this.history))
      : callback(Error('No information available'));
  }

  calculateIntensity(data: GriddyResponse, history: GriddyItem[]) {
    const low = this.calculateLow(data, history);
    return Math.round(((data.now.price_ckwh - low) / (this.calculateHigh(data) - low)) * 100);
  }

  defineLow(data: GriddyResponse, history: GriddyItem[]) {
    // if the curve is pretty flat but the price is cheap, let's go!
    return (
      data.now.price_ckwh <= this.platform.config.lowPriceCents ||
      this.calculateIntensity(data, history) <= this.platform.config.lowPricePercentage
    );
  }

  defineHigh(data: GriddyResponse, history: GriddyItem[]) {
    // if the curve is pretty flat, we don't want to call a high price event
    return (
      data.now.price_ckwh > this.platform.config.highPriceCents &&
      this.calculateIntensity(data, history) > this.platform.config.highPricePercentage
    );
  }

  calculateLow(data: GriddyResponse, history: GriddyItem[]) {
    // the lowest of today's history and the forecast low
    return Math.min(...history.map((item) => item.price_ckwh), data.now.low_ckwh);
  }

  calculateHigh(data: GriddyResponse) {
    // let's be more specific about how far out the forecast can reach.  Only look forward 18 hours
    return Math.max(...data.forecast.slice(0, 18).map((hour) => hour.price_ckwh));
  }

  handleNoData() {
    this.priceService.updateCharacteristic(this.platform.Characteristic.StatusActive, false);
    this.intensityService.updateCharacteristic(this.platform.Characteristic.On, false);
    this.lowPriceService.updateCharacteristic(this.platform.Characteristic.On, false);
    // if you got an error, schedule the next retry
    setTimeout(async () => this.update(), 10000);
  }
}
