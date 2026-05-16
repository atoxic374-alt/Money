const { owners, Colors } = require(`${process.cwd()}/settings/config`);
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const THUMB = 'https://cdn.discordapp.com/attachments/1091536665912299530/1316233635464220803/512-512-max.png?ex=675a4d99&is=6758fc19&hm=352d005827ec0252e09be31a939f3c2f1abb3c8a0d660f20012ac80a2bc62b12&';

module.exports = {
  name: 'musicaddsub',
  aliases: ['madd-sub'],
  async execute(client, message, args) {
    if (!owners.includes(message.author.id)) return;
    if (message.author.bot) return;

    const embed = new EmbedBuilder()
      .setTitle('Add Subscription')
      .setThumbnail(THUMB)
      .setDescription(
        '> **اضغط على الزر ادناه لفتح نموذج اضافة الاشتراك**\n\n' +
        '```\nUser ID\nServer ID\nBots Count\nDuration  (30d / 12h / 60m)\n```'
      )
      .setFooter({ text: message.guild.name + ' | Timer', iconURL: message.guild.iconURL({ dynamic: true }) })
      .setColor(Colors)
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open_addsub_modal')
        .setLabel('Add Subscription')
        .setStyle(ButtonStyle.Primary)
    );

    message.reply({ embeds: [embed], components: [row] });
  }
};
