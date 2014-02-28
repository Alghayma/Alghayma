#! /bin/sh

mongo alghayma ./deletePosts.js
redis-cli FLUSHALL
rm -r ../backupmedia ../tests/backupmedia ../logs
pkill node