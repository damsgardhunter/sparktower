# db.py
import pymysql
from pymysql.cursors import DictCursor
import os
from dotenv import load_dotenv

load_dotenv()

def get_connection():
    return pymysql.connect(
        host=os.getenv("Host"),
        user=os.getenv("User"),
        password=os.getenv("Password"),
        db=os.getenv("db"),
        cursorclass=DictCursor
    )
