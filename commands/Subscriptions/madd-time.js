const fs = require('fs');
const { owners, Colors, logChannelId } = require(`${process.cwd()}/settings/config`);
const { EmbedBuilder } = require('discord.js');
const ms = require('ms');

function formatDuration(msValue) {
  const days = Math.floor(msValue / (1000 * 60 * 60 * 24));
  const hours = Math.floor((msValue % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((msValue % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((msValue % (1000 * 60)) / 1000);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

module.exports = {
  name: 'musicaddtime',
  aliases: ["madd-time"],
  async execute(client, message, args) {
    if (!owners.includes(message.author.id)) return;

    const codeToAddTime = args[0];
    if (!codeToAddTime) return message.reply("**يرجى إرفاق ايدي الاشتراك**");

    const timeToAdd = args[1];
    if (!timeToAdd || !ms(timeToAdd)) return message.reply("**يرجى إرفاق وقت صحيح.**");

    try {
      const logs = fs.readFileSync('./settings/time.json', 'utf8');
      const logsArray = JSON.parse(logs);

      const matchingSubscription = logsArray.find(entry => entry.code === codeToAddTime);

      if (!matchingSubscription) {
        return message.reply("**لا يوجد اشتراك مرتبط بهذا الايدي.**");
      }

      const newExpirationTime = matchingSubscription.expirationTime + ms(timeToAdd);
      matchingSubscription.expirationTime = newExpirationTime;

      const totalRemainingTime = newExpirationTime - Date.now();
      const formattedTotalRemaining = formatDuration(totalRemainingTime);

      const logChannel = client.channels.cache.find(channel => channel.id === logChannelId);
      fs.writeFileSync('./settings/time.json', JSON.stringify(logsArray, null, 2));

      message.react('✅');

      const userId = matchingSubscription.user;
      const code = matchingSubscription.code;

      const embed = new EmbedBuilder()
        .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1316233635464220803/512-512-max.png?ex=675a4d99&is=6758fc19&hm=352d005827ec0252e09be31a939f3c2f1abb3c8a0d660f20012ac80a2bc62b12&")
        .setDescription(`\`🟢\` **Add Time**\n\n**By : <@${message.author.id}>**\n\`1\` : \`Music (SuID ${code})\` : \`${timeToAdd}\` added\nTotal remaining time: \`${formattedTotalRemaining}\` : <@${userId}>`)
        .setFooter({ text: `${message.guild.name} | Timer`, iconURL: message.guild.iconURL({ dynamic: true }) })
        .setColor(Colors);

      logChannel.send({
        embeds: [embed],
        content: "```تمت العملية بنجاح، وتمت إضافة الوقت الإضافي```"
      });

      message.react('✅');
    } catch (error) {
      console.error('❌>', error);
      message.reply('**حدث خطأ أثناء محاولة إضافة وقت للاشتراك.**');
    }
  }
};
