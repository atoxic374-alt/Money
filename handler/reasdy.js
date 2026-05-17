const { TwitchUrl, statuses } = require(`${process.cwd()}/settings/config`);

module.exports = {
  name: 'clientReady',
    // discord.js event handler option: emit once
  once: true,
  async execute(client) {

    console.table({
      Name: client.user.tag,
      BotId: client.user.id,
      Server: client.guilds.cache.size,
      Members: client.users.cache.size,
      Channels: client.channels.cache.size,
    });


    client.user.setPresence({
      status: 'dnd',
      activities: [
        {
          name: `${statuses}`,
          type: 1,
          url: `${TwitchUrl}`
        }
      ]
    });

  },
};
