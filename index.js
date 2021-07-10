
require('dotenv').config();
const Twitter = require('twitter-lite');
require('isomorphic-fetch');

const fs = require('fs');
const path = require('path');

const JAPANESE_CITIES = {
    SAPPORO: '札幌',
    SENDAI: '仙台',
    TOKYO: '東京',
    NAGOYA: '名古屋',
    OSAKA: '大阪',
    HIROSHIMA: '広島',
    FUKUOKA: '福岡',
};
exports.JAPANESE_CITIES = JAPANESE_CITIES;

const twitterClient = new Twitter({
    consumer_key: process.env.TWITTER_API_KEY,
    consumer_secret: process.env.TWITTER_API_KEY_SECRET,
    access_token_key: process.env.TWITTER_ACCESS_TOKEN,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const getJapaneseTomorrowWeather = async (city) => {
    let text = '[天気エラー]';
    try {
        let cityCode;
        switch (city) {
            case JAPANESE_CITIES.SAPPORO: cityCode = '016010'; break;
            case JAPANESE_CITIES.SENDAI: cityCode = '040010'; break;
            case JAPANESE_CITIES.TOKYO: cityCode = '130010'; break;
            case JAPANESE_CITIES.NAGOYA: cityCode = '230010'; break;
            case JAPANESE_CITIES.OSAKA: cityCode = '270000'; break;
            case JAPANESE_CITIES.HIROSHIMA: cityCode = '340010'; break;
            case JAPANESE_CITIES.FUKUOKA: cityCode = '400010'; break;
            default: cityCode = '016010';
        }
        const res = await fetch('https://weather.tsukumijima.net/api/forecast/city/' + cityCode);
        if (!res.ok) throw 'Non-2xx response';
        const data = await res.json();
        
        for (const forecast of data.forecasts) {
            if (forecast.dateLabel == '明日') {
                const weather = forecast.detail.weather.split('　').join(' ');
                let precipitation = 0;
                for (const time in forecast.chanceOfRain) {
                    const percent = +forecast.chanceOfRain[time];
                    if (!isNaN(parseInt(percent))) precipitation = Math.max(precipitation, parseInt(percent));
                }
                const high = forecast.temperature.max.celsius;
                const low = forecast.temperature.min.celsius;
                const date = forecast.date;
                text = `${date}の天気：${weather}，${null === high ? '--' : high} °C / ${null === low ? '--' : low} °C，${precipitation} %`;
                break;
            }
        }
    } catch (e) {}
    return text;
};
exports.getJapaneseTomorrowWeather = getJapaneseTomorrowWeather;

const sleep = ms => new Promise((res) => void setTimeout(() => res(), ms | 0));

const formatDiff = diff => {
    if (diff === 0) {
        return '±0';
    }
    if (!diff) {
        return '-';
    }
    if (diff > 0) {
        return '+' + (0 | diff);
    } else {
        return '-' + Math.abs(0 | diff);
    }
};

class TwitterCron {
    constructor(statePath) {
        this.statePath = path.join(__dirname, statePath || 'state.json');
        this.data = {
            cronCount: 0, // number of times of script executions with successful Twitter API calls
            followerIds: [],
            userData: null,
            tomorrowWhether: '[天気がありません]',
        };
        this.twitterUpdated = false;
        this.userId = null;
        this.screenName = null;

        this.followersCount = 0;
        this.followingCount = 0;
        this.listedCount = 0;
        this.favouritesCount = 0;
        this.postsCount = 0;

        this.followersDiff = null;
        this.followingDiff = null;
        this.listedDiff = null;
        this.favouritesDiff = null;
        this.postsDiff = null;

        this.followedIds = [];
        this.unfollowedIds = [];
        this.users = {};

        try {
            const json = fs.readFileSync(this.statePath, {encoding: 'utf-8'});
            this.data = JSON.parse(json);
        } catch (e) {}
    }

    async postTweet(text) {
        return await twitterClient.post('statuses/update', {
            status: `${this.screenName ? '@' + this.screenName : ''}\n${text}\n#真空bot`
        });
    }

    async updateTwitterData() {
        if (this.twitterUpdated) return;
        const userData = await twitterClient.get('account/verify_credentials', {skip_status: true});
        if (this.data.userData) {
            this.followersDiff = userData.followers_count - this.data.userData.followers_count;
            this.followingDiff = userData.friends_count - this.data.userData.friends_count;
            this.listedDiff = userData.listed_count - this.data.userData.listed_count;
            this.favouritesDiff = userData.favourites_count - this.data.userData.favourites_count;
            this.postsDiff = userData.statuses_count - this.data.userData.statuses_count;
        }
        this.data.userData = userData;
        this.screenName = userData.screen_name || null;
        this.userId = userData.id_str;
        this.followersCount = userData.followers_count;
        this.followingCount = userData.friends_count;
        this.listedCount = userData.listed_count;
        this.favouritesCount = userData.favourites_count;
        this.postsCount = userData.statuses_count;

        const followerIds = [];
        let cursor = -1;
        while (true) {
            await sleep(1000);
            const data = await twitterClient.get('followers/ids', {user_id: this.userId, stringify_ids: true, cursor});
            followerIds.push(... data.ids);
            if ('0' == data.next_cursor_str || !data.next_cursor) break;
        }

        if (this.data.followerIds.length) {
            const prevIds = new Set(this.data.followerIds);
            const nowIds = new Set(followerIds);
            for (const id of prevIds) {
                if (!nowIds.has(id)) {
                    this.unfollowedIds.push(id);
                } else {
                    nowIds.delete(id);
                }
            }
            for (const id of nowIds) {
                this.followedIds.push(id);
            }
        }
        this.data.followerIds = followerIds;

        const changedIds = new Set([...this.followedIds, ...this.unfollowedIds]);
        const requestIds = [];
        const users = {};
        for (const id of changedIds) {
            requestIds.push(id);
            if (requestIds.length == 100) {
                try {
                    const data = await twitterClient.get('users/lookup', {
                        user_id: requestIds.join(','),
                    });
                    for (const user of data) {
                        users[user.id_str] = {
                            id: user.id_str,
                            name: user.name,
                            screenName: user.screen_name,
                        };
                    }
                } finally {
                    requestIds.length = 0;
                }
            }
        }
        if (requestIds.length) {
            try {
                const data = await twitterClient.get('users/lookup', {
                    user_id: requestIds.join(','),
                });
                for (const user of data) {
                    users[user.id_str] = {
                        id: user.id_str,
                        name: user.name,
                        screenName: user.screen_name,
                    };
                }
            } finally {
                requestIds.length = 0;
            }
        }
        this.users = users;

        this.data.cronCount++;
        this.twitterUpdated = true;
    }

    async getTomorrowWeather(city) {
        this.data.tomorrowWhether = await getJapaneseTomorrowWeather(city);
    }

    async postStatus() {
        await this.postTweet(
            `Followers: ${this.followersCount}(${formatDiff(this.followersDiff)})\n`
            + `Following: ${this.followingCount}(${formatDiff(this.followingDiff)})\n`
            + `Listed: ${this.listedCount}(${formatDiff(this.listedDiff)})\n`
            + `Likes: ${this.favouritesCount}(${formatDiff(this.favouritesDiff)})\n`
            + `Posts: ${this.postsCount}(${formatDiff(this.postsDiff)})\n`
            + this.data.tomorrowWhether
        );
    }

    async postUnfollowed() {
        for (const id of this.unfollowedIds) {
            await sleep(1000);
            let text = `Unfollowed by: \nhttps://twitter.com/intent/user?user_id=${id}\nID: ${id}`;
            if (id in this.users) {
                const user = this.users[id];
                if (!user.protected) {
                    try {
                        await twitterClient.get('statuses/user_timeline', {user_id: id});
                    } catch (e) {
                        text += '\nIt looks I have been blocked by this user.';
                    }
                }
                text += `\nScreen name: ${user.screenName}\nName: ${user.name}`
            }
            await this.postTweet(text);
        }
    }

    async postFollowed() {
        for (const id of this.followedIds) {
            await sleep(1000);
            let text = `Followed by: \nhttps://twitter.com/intent/user?user_id=${id}\nID: ${id}`;
            if (id in this.users) {
                const user = this.users[id];
                text += `\nScreen name: ${user.screenName}\nName: ${user.name}`
            }
            await this.postTweet(text);
        }
    }

    saveData() {
        const json = JSON.stringify(this.data, null, 4);
        fs.writeFileSync(this.statePath, json, {encoding: 'utf-8'});
    }
}

exports.TwitterCron = TwitterCron;
