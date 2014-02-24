# Installing Alghayma

-------------------------------------------

1. Download & install [Node.js](http://nodejs.org), [MongoDB](http://www.mongodb.org) & [Redis](http://redis.io) on your computer
2. Download [the latest release](https://github.com/Alghayma/Alghayma/releases) of Alghayma & extract the archive
3. Open the command line and navigate to the folder where you extracted the archive
4. Run `npm install`. This command will install external modules Alghayma needs in order to run properly
5. Then go to the `deployement` and re-run `npm install`, then go back to Alghayma's root folder
6. Create a copy of the `config-example.js` file and name it `config.js`
7. Create a new [facebook application](https://developers.facebook.com/apps)
8. Update the new `config.js` file accordingly (ie, update `fbappid`, `fbapptoken` & `fbGraphAccessToken`)
9. Launch the app by running `node fileNameHere.js`, where fileNameHere.js is one of the following:
	* `app.js` if you just want to run the Alghayma web app (without the backup process)
	* `worker.js` if you just want to run the backup process alone (without the web app)
	* `watcher.js` if you want to run the website and the backup process at once. This file is in the `deployment` folder, so better move there
10. To stop a running node process, hit `Ctrl + C` on your keyboard