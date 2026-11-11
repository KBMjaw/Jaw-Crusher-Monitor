# Jaw Crusher Monitor

Edge monitoring for jaw crushers. The system uses a camera and a YOLO model to classify crusher feed, records machine data locally, and provides a web dashboard and Android app. Optional VFD control uses Modbus RTU.

## Requirements

- Python 3.11+
- IP camera with RTSP
- YOLO model weights at `weights/best.pt`
- Optional: Raspberry Pi and compatible Modbus VFD

## Setup

```bash
git clone https://github.com/KBMjaw/Jaw-Crusher-Monitor.git
cd Jaw-Crusher-Monitor
pip install -r requirements.txt
```

Create a `.env` file in the project root:

```dotenv
RTSP_URL=rtsp://<user>:<password>@<camera-ip>:<port>/<stream>
AUTH_PASS=<choose-a-password>
```

Set `VFD_ENABLED=true` and configure the VFD connection in `.env` only if you want VFD control.

## Run

```bash
python3 main.py
```

Open `http://localhost:8000` for the dashboard. The health endpoint is at `/health`.

## Tests

```bash
pytest
```

## License

MIT
