"""Starts an ipykernel the way Jupyter does, and relays control commands.

Run with the environment's own interpreter:  python kernel_wrapper.py <connection.json>

Reads one command per line on stdin:
  interrupt  - interrupt the running cell (SIGINT, or the Windows interrupt event)
  kill       - stop the kernel
When stdin closes (the study server went away) the kernel is stopped too.
"""
import os
import signal
import sys
import threading

from jupyter_client.launcher import launch_kernel


def main():
    connection_file = sys.argv[1]
    cmd = [sys.executable, "-m", "ipykernel_launcher", "-f", connection_file]
    proc = launch_kernel(cmd, cwd=os.getcwd())

    def interrupt():
        if os.name == "nt":
            from jupyter_client.win_interrupt import send_interrupt

            send_interrupt(proc.win32_interrupt_event)
        else:
            os.kill(proc.pid, signal.SIGINT)

    def commands():
        for line in sys.stdin:
            command = line.strip()
            if command == "interrupt":
                try:
                    interrupt()
                except Exception as exc:  # keep the kernel alive whatever happens
                    print("interrupt failed: %s" % exc, file=sys.stderr, flush=True)
            elif command == "kill":
                break
        proc.kill()

    threading.Thread(target=commands, daemon=True).start()
    sys.exit(proc.wait())


if __name__ == "__main__":
    main()
