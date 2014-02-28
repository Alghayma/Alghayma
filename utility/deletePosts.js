db.fbposts.drop();
db.fbfeeds.update({didBackupHead: true}, {$set: {didBackupHead: false}}, {multi: true});
db.fbposts.ensureIndex({postId: 1}, {unique: true, dropDups: true});