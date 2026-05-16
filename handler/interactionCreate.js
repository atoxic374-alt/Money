const fs   = require('fs');
const cfg  = require(`${process.cwd()}/settings/config`);
const {
  EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const ms = require('ms');

const THUMB = 'https://cdn.discordapp.com/attachments/1091536665912299530/1316233635464220803/512-512-max.png?ex=675a4d99&is=6758fc19&hm=352d005827ec0252e09be31a939f3c2f1abb3c8a0d660f20012ac80a2bc62b12&';

/* prevent the same modal submit from being processed twice */
const processingSet = new Set();

/* ── helpers ──────────────────────────────────────────────────────────────── */

function parseDuration(input) {
  if (!input || typeof input !== 'string' || !input.trim()) return null;
  try {
    const v = ms(input.trim());
    return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : null;
  } catch { return null; }
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw || !raw.trim()) return fallback;
    const p = JSON.parse(raw);
    return (p !== null && p !== undefined) ? p : fallback;
  } catch { return fallback; }
}

function formatDuration(v) {
  const d = Math.floor(v / 86400000);
  const h = Math.floor((v % 86400000) / 3600000);
  const m = Math.floor((v % 3600000)  / 60000);
  const s = Math.floor((v % 60000)    / 1000);
  return d + 'd ' + h + 'h ' + m + 'm ' + s + 's';
}

function randCode(len) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let o = '';
  for (let i = 0; i < len; i++) o += c[Math.floor(Math.random() * c.length)];
  return o;
}

function errReply(interaction, desc) {
  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Error')
        .setDescription(desc)
        .setFooter({ text: interaction.guild.name + ' | Subscriptions', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setColor('#E74C3C')
        .setTimestamp()
    ]
  });
}

/* ── module ───────────────────────────────────────────────────────────────── */

module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction, client) {

    /* ── Button: open modal ──────────────────────────────────────────────── */
    if (interaction.isButton() && interaction.customId === 'open_addsub_modal') {

      if (!cfg.owners.includes(interaction.user.id)) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setDescription('**لا تملك صلاحية لاستخدام هذا الزر.**').setColor('#E74C3C')],
          ephemeral: true
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('addsub_modal:' + interaction.message.id)
        .setTitle('Add Subscription');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('user_id').setLabel('User ID')
            .setPlaceholder('123456789012345678')
            .setStyle(TextInputStyle.Short).setMinLength(17).setMaxLength(20).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('server_id').setLabel('Server ID')
            .setPlaceholder('987654321098765432')
            .setStyle(TextInputStyle.Short).setMinLength(17).setMaxLength(20).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bots_count').setLabel('Bots Count')
            .setPlaceholder('3')
            .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(3).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('duration').setLabel('Duration  (30d / 12h / 60m)')
            .setPlaceholder('30d')
            .setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(10).setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    /* ── Modal submit ────────────────────────────────────────────────────── */
    if (interaction.isModalSubmit() && interaction.customId.startsWith('addsub_modal:')) {

      if (!cfg.owners.includes(interaction.user.id)) return;

      /* deduplication — ignore if this exact interaction is already being handled */
      if (processingSet.has(interaction.id)) return;
      processingSet.add(interaction.id);
      setTimeout(function() { processingSet.delete(interaction.id); }, 30000);

      const originalMsgId = interaction.customId.split(':')[1];

      await interaction.deferReply({ ephemeral: true });

      const userId   = interaction.fields.getTextInputValue('user_id').trim();
      const serverId = interaction.fields.getTextInputValue('server_id').trim();
      const countRaw = interaction.fields.getTextInputValue('bots_count').trim();
      const durRaw   = interaction.fields.getTextInputValue('duration').trim();

      /* ── validate user id ───────────────────────────────────────────────── */
      if (!/^\d{17,20}$/.test(userId))
        return errReply(interaction, '**ايدي المستخدم يجب ان يكون رقما من 17 الى 20 خانة.**');

      let targetUser;
      try { targetUser = await interaction.client.users.fetch(userId); }
      catch { return errReply(interaction, '**لم يتم العثور على المستخدم. تاكد من صحة الايدي.**'); }

      /* ── validate server id ─────────────────────────────────────────────── */
      if (!/^\d{17,20}$/.test(serverId))
        return errReply(interaction, '**ايدي السيرفر يجب ان يكون رقما من 17 الى 20 خانة.**');

      /* ── validate bots count ────────────────────────────────────────────── */
      const count = parseInt(countRaw, 10);
      if (isNaN(count) || count <= 0)
        return errReply(interaction, '**يرجى ادخال عدد صحيح وموجب للبوتات.**');

      const bots = readJson('./settings/bots.json', []);
      if (!Array.isArray(bots))
        return errReply(interaction, '**حدث خطا اثناء قراءة ملف البوتات.**');
      if (bots.length === 0)
        return errReply(interaction, '**لا توجد بوتات متاحة حاليا. اضف بوتات اولا عبر** `madd-tokens`**.**');
      if (count > bots.length)
        return errReply(interaction, '**البوتات المطلوبة** `(' + count + ')` **اكبر من المتاح** `(' + bots.length + ')`**. اضف المزيد اولا.**');

      /* ── duplicate check: same user + same server ───────────────────────── */
      const timeArr = readJson('./settings/time.json', []);
      if (!Array.isArray(timeArr))
        return errReply(interaction, '**حدث خطا اثناء قراءة بيانات الاشتراكات.**');

      const alreadyExists = timeArr.find(function(e) {
        return e.user === userId && e.server === serverId && e.expirationTime > Date.now();
      });
      if (alreadyExists)
        return errReply(interaction,
          '**هذا المستخدم لديه اشتراك نشط على نفس السيرفر بالفعل** `(' + alreadyExists.code + ')`**.**\n' +
          '**استخدم** `madd-time` **لتعديل مدة الاشتراك الحالي بدلا من انشاء جديد.**'
        );

      /* ── validate duration ──────────────────────────────────────────────── */
      const dur = parseDuration(durRaw);
      if (!dur)
        return errReply(interaction,
          '**صيغة الوقت** `' + durRaw + '` **غير صحيحة. استخدم مثلا:** `30d` **او** `12h` **او** `60m`**.**'
        );

      /* ── decide number of groups ─────────────────────────────────────────
         Split into 3 groups ONLY when count > 50.
         Otherwise a single SuID covers all bots.
      ─────────────────────────────────────────────────────────────────────── */
      const numGroups  = count > 50 ? 3 : 1;
      const formatted  = formatDuration(dur);
      const expireTime = Date.now() + dur;
      const expireStr  = new Date(expireTime).toLocaleString('ar-EG', { timeZone: 'Asia/Riyadh' });

      const groupSizes = [];
      for (let g = 0; g < numGroups; g++) {
        groupSizes.push(Math.floor(count / numGroups) + (g < count % numGroups ? 1 : 0));
      }

      const codes = [];
      for (let g = 0; g < numGroups; g++) codes.push(randCode(5));

      /* ── save time.json ──────────────────────────────────────────────────── */
      try {
        for (let g = 0; g < numGroups; g++) {
          timeArr.push({
            user: userId,
            server: serverId,
            botsCount: groupSizes[g],
            subscriptionTime: durRaw,
            expirationTime: expireTime,
            code: '#' + codes[g]
          });
        }
        fs.writeFileSync('./settings/time.json', JSON.stringify(timeArr, null, 2));
      } catch (e) {
        console.error('> time.json write error:', e);
        return errReply(interaction, '**حدث خطا اثناء حفظ بيانات الاشتراك. حاول مرة اخرى.**');
      }

      /* ── assign tokens per group ─────────────────────────────────────────── */
      const givenTokens = bots.splice(0, count);
      let tokens = readJson('./settings/tokens.json', []);
      if (!Array.isArray(tokens)) tokens = [];

      let offset = 0;
      for (let g = 0; g < numGroups; g++) {
        const groupBots = givenTokens.slice(offset, offset + groupSizes[g]);
        offset += groupSizes[g];
        groupBots.forEach(function(b) {
          tokens.push({
            token: b.token, Server: serverId, channel: null,
            chat: null, status: null, client: userId, code: '#' + codes[g]
          });
        });
      }

      try {
        fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens, null, 2));
        fs.writeFileSync('./settings/bots.json',   JSON.stringify(bots,   null, 2));
      } catch (e) {
        console.error('> tokens/bots write error:', e);
        return errReply(interaction, '**حدث خطا اثناء حفظ التوكنات.**');
      }

      /* ── build description lines ─────────────────────────────────────────── */
      let descLines = '';
      for (let g = 0; g < numGroups; g++) {
        descLines += '`' + (g + 1) + '` : `Music x' + groupSizes[g] + ' (SuID #' + codes[g] + ') : ' + formatted + '` <@' + userId + '>\n';
      }

      /* ── success embed ───────────────────────────────────────────────────── */
      const successEmbed = new EmbedBuilder()
        .setTitle('Subscription Added')
        .setThumbnail(THUMB)
        .setDescription('> **بواسطّة :** <@' + interaction.user.id + '>\n' + descLines)
        .addFields(
          { name: 'Server',     value: '`' + serverId  + '`',        inline: true },
          { name: 'Duration',   value: '`' + formatted  + '`',       inline: true },
          { name: 'Expires',    value: '`' + expireStr  + '`',       inline: true },
          { name: 'Packages',   value: '`' + numGroups + ' SuID(s)`', inline: true },
          { name: 'Total Bots', value: '`' + count + '`',            inline: true }
        )
        .setFooter({ text: interaction.guild.name + ' | Timer', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setColor(cfg.Colors)
        .setTimestamp();

      /* ── update the original button message (disable button + new embed) ─── */
      try {
        const origMsg = await interaction.channel.messages.fetch(originalMsgId);
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_addsub_modal')
            .setLabel('Add Subscription')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true)
        );
        await origMsg.edit({ embeds: [successEmbed], components: [disabledRow] });
      } catch (e) {
        console.error('> failed to update original message:', e.message);
      }

      await interaction.deleteReply().catch(function() {});

      /* ── DM to user ──────────────────────────────────────────────────────── */
      const dmEmbed = new EmbedBuilder()
        .setTitle('New Subscription')
        .setThumbnail(THUMB)
        .setDescription(
          '> **الاسم :** <@' + userId + '>\n' +
          '> **المدة :** `' + formatted + '`\n' +
          '> **ينتهي في :** `' + expireStr + '`\n\n' +
          descLines
        )
        .setFooter({ text: interaction.guild.name + ' | Timer', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setColor(cfg.Colors)
        .setTimestamp();

      targetUser.send({ content: '> <@' + userId + '>', embeds: [dmEmbed] })
        .catch(function(e) { console.error('> DM failed to ' + targetUser.tag + ':', e.message); });

      /* ── log channel ─────────────────────────────────────────────────────── */
      if (!cfg.logChannelId) return;
      const logCh = interaction.client.channels.cache.get(cfg.logChannelId);
      if (!logCh) return;

      const logEmbed = new EmbedBuilder()
        .setTitle('Subscription Added')
        .setThumbnail(THUMB)
        .setDescription('> **بواسطّة :** <@' + interaction.user.id + '>\n' + descLines)
        .setFooter({ text: interaction.guild.name + ' | Timer', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setColor(cfg.Colors)
        .setTimestamp();

      logCh.send({ embeds: [logEmbed] })
        .catch(function(e) { console.error('> log channel send failed:', e.message); });
    }
  }
};
