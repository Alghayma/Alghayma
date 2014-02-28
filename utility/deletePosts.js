db.fbposts.drop();
db.fbfeeds.update({didBackupHead: true}, {$set: {didBackupHead: false}}, {multi: true});