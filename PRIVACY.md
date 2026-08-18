# Privacy Policy — FuelPilot

**Last updated: 18 August 2026**

FuelPilot is a fuel and maintenance tracker for your own vehicles. This policy
explains what the app does with your information. The short version: everything
stays on your device, and there is no server to send it to.

## What FuelPilot collects

**Nothing is collected.** The app has no account system, no analytics, no
crash reporting service, no advertising and no tracking of any kind.

## What FuelPilot stores, and where

Everything you enter is written to your device's local app storage and never
leaves it unless you explicitly export it:

- Vehicles (name, make, model, year, fuel type, tank size, currency)
- Refuel records (date, odometer, litres, price, station, notes, trip tags)
- Receipt photos you choose to attach
- Maintenance reminders and their service history
- Manual odometer readings
- Your settings (theme, budget, reminder thresholds, consumption targets)

This data is readable only by FuelPilot. Uninstalling the app deletes it.

## Network access

FuelPilot does not transmit your data anywhere. The app works fully offline and
contacts no server during normal use.

The Android app declares the `INTERNET` permission because it runs its interface
in a system WebView component that requires it. No user data is sent over the
network.

## Permissions and why they are needed

| Permission | Why |
| --- | --- |
| `INTERNET` | Required by the WebView component that renders the interface. No data is transmitted. |
| `POST_NOTIFICATIONS` | To show maintenance reminders you have scheduled yourself. Only requested when you enable them. |
| `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED` | So a scheduled reminder still arrives on the right day and survives a restart. |
| `VIBRATE` | Brief haptic feedback when saving or deleting an entry. |

Receipt photos are taken through the system camera or file picker, so the app
never needs the camera permission itself and receives only the image you pick.

## Backups

Two things can copy your data off the device, both under your control:

1. **Export**, which you start yourself. The resulting JSON or CSV file goes
   wherever you choose to save or share it. Once exported, that file is outside
   the app's control and this policy no longer covers it.
2. **Android system backup**, if you have Google's automatic backup switched on
   for your device. That copy is handled by Google under
   [Google's privacy policy](https://policies.google.com/privacy), not by us.
   You can disable it in your device's backup settings.

## Third parties

FuelPilot integrates no third-party SDKs and shares data with no one. The app is
built with open-source libraries (React, Chart.js, Capacitor) that run entirely
on your device and send nothing anywhere.

## Children

FuelPilot is a general-purpose utility, is not directed at children, and
collects nothing from anyone regardless of age.

## Your rights over your data

Because the data never leaves your device, you already have full control:

- **View or extract it** — Settings → Export (JSON or CSV)
- **Delete some of it** — delete individual entries, or a vehicle with its records
- **Delete all of it** — Settings → Clear, or uninstall the app

There is no data on our side to request, correct or erase, because none is ever
received.

## Changes to this policy

Any change will be published in this file with a new date at the top. Material
changes will also be noted in the release notes for the version that carries them.

## Contact

Questions about this policy can be raised as an issue at
<https://github.com/PTred-gjo/consumption-tracker/issues>.
