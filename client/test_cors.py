import requests

try:
    r = requests.options("http://localhost:5001/")
    print(r.text)
    print("Status code:", r.status_code)
    print("Headers:")
    for key, value in r.headers.items():
        print(f"{key}: {value}")
except Exception as e:
    print("Error:", e)