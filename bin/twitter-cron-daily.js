
const cron = require('../index');

cron.getJapaneseTomorrowWeather().then(text => console.log(text));

const service = new cron.TwitterCron();
(async () => {
    //
    await service.updateTwitterData();
    console.log(service);
    await service.postStatus();
    await service.postFollowed();
    await service.getTomorrowWeather();
    service.saveData();
})();
