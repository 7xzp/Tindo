import os
import json
from typing import Optional
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

TOKEN_CACHE_FILE = "data/gmail_token.json"


class GmailAuth:
    def __init__(self, config: dict):
        self.client_id = config["client_id"]
        self.client_secret = config["client_secret"]
        self.redirect_uri = config["redirect_uri"]
        self.scopes = config["scopes"]
        self.client_config = {
            "web": {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [self.redirect_uri],
            }
        }

    def get_auth_url(self) -> tuple:
        flow = Flow.from_client_config(
            self.client_config, scopes=self.scopes, redirect_uri=self.redirect_uri
        )
        url, state = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="false",
            prompt="consent",
        )
        return url, state

    def exchange_code(self, code: str) -> dict:
        flow = Flow.from_client_config(
            self.client_config, scopes=self.scopes, redirect_uri=self.redirect_uri
        )
        flow.fetch_token(code=code)
        self._save_credentials(flow.credentials)
        return {"ok": True}

    def _save_credentials(self, creds: Credentials):
        os.makedirs(os.path.dirname(TOKEN_CACHE_FILE), exist_ok=True)
        with open(TOKEN_CACHE_FILE, "w") as f:
            json.dump({
                "token": creds.token,
                "refresh_token": creds.refresh_token,
                "token_uri": creds.token_uri,
                "client_id": creds.client_id,
                "client_secret": creds.client_secret,
                "scopes": creds.scopes,
                "expiry": creds.expiry.isoformat() if creds.expiry else None,
            }, f)

    def get_credentials(self) -> Optional[Credentials]:
        if not os.path.exists(TOKEN_CACHE_FILE):
            return None
        with open(TOKEN_CACHE_FILE, "r") as f:
            data = json.load(f)
        creds = Credentials(
            token=data.get("token"),
            refresh_token=data.get("refresh_token"),
            token_uri=data.get("token_uri"),
            client_id=data.get("client_id"),
            client_secret=data.get("client_secret"),
            scopes=data.get("scopes"),
        )
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            self._save_credentials(creds)
        return creds

    def is_authenticated(self) -> bool:
        creds = self.get_credentials()
        return creds is not None and creds.valid

    def sign_out(self):
        if os.path.exists(TOKEN_CACHE_FILE):
            os.remove(TOKEN_CACHE_FILE)
