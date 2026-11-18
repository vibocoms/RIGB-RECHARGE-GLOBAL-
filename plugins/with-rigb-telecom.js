const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");

const moduleSource = String.raw`package __PACKAGE__;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.util.List;

public class RigbTelecomModule extends ReactContextBaseJavaModule {
  private final ReactApplicationContext reactContext;

  RigbTelecomModule(ReactApplicationContext context) {
    super(context);
    this.reactContext = context;
  }

  @NonNull
  @Override
  public String getName() {
    return "RigbTelecom";
  }

  @ReactMethod
  public void getSimCards(Promise promise) {
    try {
      if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_PHONE_STATE)
          != PackageManager.PERMISSION_GRANTED) {
        promise.reject("READ_PHONE_STATE_DENIED", "READ_PHONE_STATE permission is required");
        return;
      }
      SubscriptionManager subscriptionManager =
          (SubscriptionManager) reactContext.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
      List<SubscriptionInfo> subscriptions = subscriptionManager.getActiveSubscriptionInfoList();
      WritableArray result = Arguments.createArray();
      if (subscriptions != null) {
        for (SubscriptionInfo info : subscriptions) {
          WritableMap sim = Arguments.createMap();
          CharSequence carrier = info.getCarrierName();
          sim.putString("carrierName", carrier == null ? "Unknown carrier" : carrier.toString());
          sim.putString("number", info.getNumber() == null ? "" : info.getNumber());
          sim.putInt("subscriptionId", info.getSubscriptionId());
          sim.putInt("slotIndex", info.getSimSlotIndex());
          result.pushMap(sim);
        }
      }
      promise.resolve(result);
    } catch (SecurityException error) {
      promise.reject("READ_PHONE_STATE_DENIED", error.getMessage(), error);
    } catch (Exception error) {
      promise.reject("SIM_LOOKUP_FAILED", error.getMessage(), error);
    }
  }

  @ReactMethod
  public void dialUssd(String ussd, int subscriptionId, Promise promise) {
    try {
      if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.CALL_PHONE)
          != PackageManager.PERMISSION_GRANTED) {
        promise.reject("CALL_PHONE_DENIED", "CALL_PHONE permission is required");
        return;
      }
      TelephonyManager telephonyManager =
          (TelephonyManager) reactContext.getSystemService(Context.TELEPHONY_SERVICE);
      PhoneAccountHandle phoneAccountHandle =
          telephonyManager.getPhoneAccountHandleForSubscriptionId(subscriptionId);
      Uri uri = Uri.parse("tel:" + ussd.replace("#", "%23"));
      Bundle extras = new Bundle();
      if (phoneAccountHandle != null) {
        extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, phoneAccountHandle);
      }
      TelecomManager telecomManager =
          (TelecomManager) reactContext.getSystemService(Context.TELECOM_SERVICE);
      telecomManager.placeCall(uri, extras);
      promise.resolve(true);
    } catch (SecurityException error) {
      promise.reject("CALL_PHONE_DENIED", error.getMessage(), error);
    } catch (Exception error) {
      promise.reject("DIAL_FAILED", error.getMessage(), error);
    }
  }
}
`;

const packageSource = String.raw`package __PACKAGE__;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class RigbTelecomPackage implements ReactPackage {
  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
    List<NativeModule> modules = new ArrayList<>();
    modules.add(new RigbTelecomModule(reactContext));
    return modules;
  }

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }
}
`;

module.exports = function withRigbTelecom(config) {
  const androidPackage = config.android?.package || "space.manus.rigbrecharge";
  const packagePath = androidPackage.replace(/\./g, "/");

  config = withAndroidManifest(config, (manifestConfig) => {
    const permissions =
      manifestConfig.modResults.manifest["uses-permission"] || [];
    for (const name of [
      "android.permission.CALL_PHONE",
      "android.permission.READ_PHONE_STATE",
    ]) {
      if (
        !permissions.some(
          (permission) => permission.$?.["android:name"] === name,
        )
      ) {
        permissions.push({ $: { "android:name": name } });
      }
    }
    manifestConfig.modResults.manifest["uses-permission"] = permissions;
    return manifestConfig;
  });

  config = withMainApplication(config, (applicationConfig) => {
    let contents = applicationConfig.modResults.contents;
    const importLine = `import ${androidPackage}.RigbTelecomPackage`;
    if (!contents.includes(importLine)) {
      contents = contents.replace(
        `import expo.modules.ApplicationLifecycleDispatcher`,
        `${importLine}\nimport expo.modules.ApplicationLifecycleDispatcher`,
      );
    }
    if (!contents.includes("add(RigbTelecomPackage())")) {
      contents = contents.replace(
        "// add(MyReactNativePackage())",
        "add(RigbTelecomPackage())",
      );
    }
    applicationConfig.modResults.contents = contents;
    return applicationConfig;
  });

  config = withDangerousMod(config, [
    "android",
    async (dangerousConfig) => {
      const androidRoot = dangerousConfig.modRequest.platformProjectRoot;
      const sourceRoot = path.join(
        androidRoot,
        "app",
        "src",
        "main",
        "java",
        packagePath,
      );
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.writeFileSync(
        path.join(sourceRoot, "RigbTelecomModule.java"),
        moduleSource.replaceAll("__PACKAGE__", androidPackage),
      );
      fs.writeFileSync(
        path.join(sourceRoot, "RigbTelecomPackage.java"),
        packageSource.replaceAll("__PACKAGE__", androidPackage),
      );
      return dangerousConfig;
    },
  ]);

  return config;
};
