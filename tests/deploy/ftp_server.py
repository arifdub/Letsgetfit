"""Throwaway FTP(S) server for testing scripts/deploy-ftp.sh.

Usage: python ftp_server.py ROOT PORT USER PASSWORD CERTFILE|none
Prints "READY" once listening. Requires pyftpdlib and pyOpenSSL.
"""
import sys

from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler, TLS_FTPHandler
from pyftpdlib.servers import FTPServer

root, port, user, password, cert = sys.argv[1:6]

authorizer = DummyAuthorizer()
authorizer.add_user(user, password, root, perm="elradfmwMT")

if cert == "none":
    handler = FTPHandler
else:
    handler = TLS_FTPHandler
    handler.certfile = cert
    handler.tls_control_required = True
    handler.tls_data_required = True
handler.authorizer = authorizer
handler.passive_ports = range(30000, 30100)

server = FTPServer(("127.0.0.1", int(port)), handler)
print("READY", flush=True)
server.serve_forever()
