"use strict";

var Android = require('./android.js')
  , _ = require('underscore')
  , logger = require('../../server/logger.js').get('appium')
  , async = require('async')
  , ADB = require('./adb.js')
  , Chromedriver = require('./chromedriver.js');

var ChromeAndroid = function () {
  this.init();
};

_.extend(ChromeAndroid.prototype, Android.prototype);
ChromeAndroid.prototype._androidInit = Android.prototype.init;
ChromeAndroid.prototype.init = function () {
  this._androidInit();
  this.avoidProxy = [];
  this.isProxy = true;
  this.adb = null;
  this.onDie = null;
};

ChromeAndroid.prototype.configure = function (args, caps, cb) {
  logger.debug("Looks like we want chrome on android");
  this._deviceConfigure(args, caps);
  var bName = this.args.browserName || "";
  var app = this.appString().toLowerCase() ||
            bName.toString().toLowerCase();
  if (app === "chromium") {
    this.args.androidPackage = "org.chromium.chrome.testshell";
    this.args.androidActivity = "org.chromium.chrome.testshell.Main";
  } else if (app === "chromebeta") {
    this.args.androidPackage = "com.chrome.beta";
    this.args.androidActivity = "com.google.android.apps.chrome.Main";
  } else if (app === "browser") {
    this.args.androidPackage = "com.android.browser";
    this.args.androidActivity = "com.android.browser.BrowserActivity";
  } else {
    this.args.androidPackage = "com.android.chrome";
    this.args.androidActivity = "com.google.android.apps.chrome.Main";
  }
  // don't allow setAndroidArgs to reclobber our androidPackage/activity
  delete this.capabilities.appPackage;
  delete this.capabilities.appActivity;
  this.setAndroidArgs();
  this.args.app = null;
  this.args.systemPort = this.args.chromeDriverPort;
  this.args.proxyPort = this.args.systemPort;
  cb();
};

ChromeAndroid.prototype.start = function (cb, onDie) {
  this.adb = new ADB(this.args);
  this.onDie = onDie;

  async.series([
    this.prepareDevice.bind(this),
    this.prepareChromedriver.bind(this),
    this.unlock.bind(this),
    this.createSession.bind(this)
  ], function (err, results) {
    if (err) return cb(err);
    var sessionId = results[3];
    cb(null, sessionId);
  });
};

ChromeAndroid.prototype.prepareChromedriver = function (cb) {
  var chromeArgs = {
    port: this.args.proxyPort
  , executable: this.args.chromedriverExecutable
  , deviceId: this.adb.curDeviceId
  , enablePerformanceLogging: this.args.enablePerformanceLogging
  };
  this.chromedriver = new Chromedriver(chromeArgs,
      this.onChromedriverExit.bind(this));
  this.proxyTo = this.chromedriver.proxyTo.bind(this.chromedriver);
  this.proxyHost = this.chromedriver.proxyHost;
  this.proxyPort = this.chromedriver.proxyPort;
  this.deleteSession = this.chromedriver.deleteSession.bind(this.chromedriver);
  cb();
};

ChromeAndroid.prototype.unlock = function (cb) {
  this.pushUnlock(function (err) {
    if (err) return cb(err);
    this.unlockScreen(cb);
  }.bind(this));
};

ChromeAndroid.prototype.createSession = function (cb) {
  var caps = {
    chromeOptions: {
      androidPackage: this.args.appPackage,
      androidActivity: this.args.appActivity
    }
  };
  var knownPackages = ["org.chromium.chrome.testshell", "com.android.chrome",
                       "com.chrome.beta"];
  if (_.contains(knownPackages, this.args.appPackage)) {
    delete caps.chromeOptions.androidActivity;
  }
  this.chromedriver.createSession(caps, cb);
};

ChromeAndroid.prototype.stop = function (cb) {
  this.chromedriver.stop(function (err) {
    if (err) return cb(err);
    this.adb.forceStop(this.args.appPackage, function (err) {
      if (err) return cb(err);
      this.adb.stopLogcat(cb);
    }.bind(this));
  }.bind(this));
};

ChromeAndroid.prototype.onChromedriverExit = function () {
  async.series([
    this.adb.getConnectedDevices.bind(this.adb),
    _.partial(this.adb.forceStop.bind(this.adb), this.args.appPackage)
  ], function (err) {
    if (err) logger.error(err.message);
    this.adb.stopLogcat(this.onDie.bind(this));
  }.bind(this));
};

module.exports = ChromeAndroid;
