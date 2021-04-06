
const cron = require('../index');

cron.getJapaneseTomorrowWeather().then(text => console.log(text));

const service = new cron.TwitterCron();
(async () => {
    //
    await service.updateTwitterData();
    await service.postStatus();
    await service.postUnfollowed();
    await service.getTomorrowWeather();
    service.saveData();
})();
