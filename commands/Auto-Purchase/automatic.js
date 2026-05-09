const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { owners } = require(`${process.cwd()}/Settings/config`);

module.exports = {
  name: "automatic",
  aliases: ["ظبط"],
  description: "Edit avatar commands",
  async execute(client, message, args) {
    if (!owners.includes(message.author.id)) return;

    const buying = new ButtonBuilder()
      .setCustomId("SelectBots")
      .setLabel("شَراء.")
      .setEmoji("🛒")
      .setStyle(ButtonStyle.Secondary);

    const renewal = new ButtonBuilder()
      .setCustomId("renewal")
      .setLabel("تجَديد.")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder().addComponents(buying, renewal);

    await message.channel.send({
      files: ["settings/image/Auto.png"],
      components: [row1],
    });
  },
};
