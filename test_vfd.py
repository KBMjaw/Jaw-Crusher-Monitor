"""
Quick standalone VFD test — runs outside the full server.
On start: reads and shows current speed from the drive.
Enter Hz value at the prompt → converts to RPM → sends to VFD → shows result.
Enter 'r' to read current speed at any time.
Enter 'm' to monitor speed live (Ctrl+C to stop).

Motor: 1500 RPM @ 50 Hz (4-pole)
Hz → RPM conversion: rpm = (hz / 50) * 1500

Usage:
    python test_vfd.py
"""
import asyncio
import logging
import sys

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)

MOTOR_RATED_RPM = 1500
MOTOR_RATED_HZ  = 50

def hz_to_rpm(hz: float) -> int:
    return int(round((hz / MOTOR_RATED_HZ) * MOTOR_RATED_RPM))

def rpm_to_hz(rpm) -> float:
    if rpm is None:
        return None
    return round(rpm * MOTOR_RATED_HZ / MOTOR_RATED_RPM, 1)

async def read_and_print(vfd):
    """Read status from VFD and print current speed."""
    await vfd.read_status()
    s = vfd.status
    actual_hz  = rpm_to_hz(s['actual_rpm'])
    target_hz  = rpm_to_hz(s['target_rpm']) if s['target_rpm'] else 0.0
    actual_rpm = s['actual_rpm'] if s['actual_rpm'] is not None else 'N/A'
    sw         = s.get('status_word', {})
    running    = sw.get('running', False)
    tripped    = sw.get('tripped', False)
    remote     = sw.get('remote', False)
    at_sp      = sw.get('at_setpoint', False)

    print(f"\n  ── VFD Status ──────────────────────────")
    print(f"  Target  : {target_hz} Hz  ({s['target_rpm']} RPM)")
    print(f"  Actual  : {actual_hz} Hz  ({actual_rpm} RPM)")
    print(f"  Running : {'YES' if running else 'NO'}   "
          f"At setpoint: {'YES' if at_sp else 'NO'}   "
          f"Remote: {'YES' if remote else 'NO'}   "
          f"Fault: {'YES' if tripped else 'NO'}")
    if s['last_error']:
        print(f"  Error   : {s['last_error']}")
    print(f"  Writes  : {s['total_writes']}   Errors: {s['total_errors']}")
    print(f"  ────────────────────────────────────────\n")

async def monitor_loop(vfd):
    """Continuously read and display speed every 1 second."""
    print("  Monitoring live speed — press Ctrl+C to stop\n")
    try:
        while True:
            await vfd.read_status()
            s          = vfd.status
            actual_hz  = rpm_to_hz(s['actual_rpm'])
            target_hz  = rpm_to_hz(s['target_rpm']) if s['target_rpm'] else 0.0
            running    = s.get('status_word', {}).get('running', False)
            print(f"  Target: {target_hz:5.1f} Hz   Actual: {str(actual_hz):>5} Hz   "
                  f"Running: {'YES' if running else 'NO '}   "
                  f"Errors: {s['total_errors']}", end="\r")
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print("\n  Monitor stopped.\n")

async def main():
    from vfd_controller import VFDController

    vfd = VFDController()

    print("\n── Connecting to VFD ───────────────────────────")
    await vfd.connect()
    print(f"connected={vfd.status['connected']}  initialized={vfd.status['initialized']}")

    if not vfd.status["connected"]:
        print("❌ VFD not connected — check RS-485 cable and /dev/ttyUSB0")
        sys.exit(1)

    # ── Read current speed immediately on connect ────────────
    print("\n── Current VFD Speed (at startup) ──────────────")
    await read_and_print(vfd)

    print("Commands:")
    print("  <Hz>  — send speed (0–50 Hz),  e.g. 30")
    print("  r     — read current speed")
    print("  m     — live monitor (Ctrl+C to stop)")
    print("  s     — stop drive")
    print("  q     — quit\n")

    while True:
        try:
            user_input = input("Enter command → ").strip().lower()
        except (KeyboardInterrupt, EOFError):
            break

        if user_input == "q":
            break

        elif user_input == "r":
            await read_and_print(vfd)
            continue

        elif user_input == "m":
            await monitor_loop(vfd)
            continue

        elif user_input == "s":
            print("  Stopping drive...")
            await vfd.stop_drive()
            await asyncio.sleep(2)
            await read_and_print(vfd)
            continue

        else:
            try:
                hz = float(user_input)
            except ValueError:
                print("  Invalid — enter a number (0–50), or r / m / s / q\n")
                continue

            if hz < 0 or hz > 50:
                print("  Out of range — enter 0 to 50 Hz\n")
                continue

            rpm = hz_to_rpm(hz)
            print(f"  Sending {hz} Hz ({rpm} RPM) to VFD...")

            if hz == 0:
                await vfd.stop_drive()
            else:
                await vfd.set_speed(rpm)

            await asyncio.sleep(3)
            await read_and_print(vfd)

    print("\n── Stopping VFD ────────────────────────────────")
    await vfd.stop_drive()
    await vfd.disconnect()
    print("Done")

asyncio.run(main())
