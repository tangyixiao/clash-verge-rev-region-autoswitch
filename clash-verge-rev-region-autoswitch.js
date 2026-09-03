// Clash Verge Rev 扩展脚本
// 远程订阅自动更新 + 分地区自动测速 + 保留全部单节点 + Tailscale 跨地区故障转移

function main(config) {
  const HEALTH_URL = "https://www.gstatic.com/generate_204";

  // 普通地区自动组：2 分钟测速一次
  const INTERVAL = 120;

  // 延迟差不大时尽量不频繁切换
  const TOLERANCE = 80;

  const PREFIX = "⚡ ";
  const ROOT_SELECTOR = "🔰 选择节点";
  const REGION_SELECTOR = "🌍 地区自动";
  const MANUAL_SELECTOR = "🧭 手动选择";
  const TS_GROUP = "🛡️ Tailscale故障转移";

  // 常用地区
  const COMMON_REGIONS = [
    "日本",
    "香港",
    "新加坡",
    "美国"
  ];

  // 不常用地区
  const OTHER_REGIONS = [
    "台湾",
    "韩国",
    "英国",
    "德国",
    "法国",
    "加拿大",
    "澳大利亚",
    "俄罗斯",
    "土耳其",
    "印度",
    "阿根廷",
    "乌克兰"
  ];

  const REGION_PRIORITY = [
    ...COMMON_REGIONS,
    ...OTHER_REGIONS
  ];

  const regionDefs = [
    {
      key: "香港",
      names: ["香港"],
      flags: ["🇭🇰"]
    },
    {
      key: "日本",
      names: ["日本", "东京", "大阪"],
      flags: ["🇯🇵"]
    },
    {
      key: "新加坡",
      names: ["新加坡", "狮城"],
      flags: ["🇸🇬"]
    },
    {
      key: "台湾",
      names: ["台湾", "台北"],
      flags: ["🇹🇼"]
    },
    {
      key: "美国",
      names: [
        "美国",
        "洛杉矶",
        "圣何塞",
        "西雅图"
      ],
      flags: ["🇺🇸", "🇺🇲"]
    },
    {
      key: "英国",
      names: ["英国", "伦敦"],
      flags: ["🇬🇧"]
    },
    {
      key: "阿根廷",
      names: ["阿根廷"],
      flags: ["🇦🇷"]
    },
    {
      key: "俄罗斯",
      names: ["俄罗斯"],
      flags: ["🇷🇺"]
    },
    {
      key: "土耳其",
      names: ["土耳其"],
      flags: ["🇹🇷"]
    },
    {
      key: "韩国",
      names: ["韩国", "首尔"],
      flags: ["🇰🇷"]
    },
    {
      key: "印度",
      names: ["印度"],
      flags: ["🇮🇳"]
    },
    {
      key: "德国",
      names: ["德国", "法兰克福"],
      flags: ["🇩🇪"]
    },
    {
      key: "加拿大",
      names: ["加拿大", "多伦多"],
      flags: ["🇨🇦"]
    },
    {
      key: "澳大利亚",
      names: [
        "澳大利亚",
        "澳洲",
        "悉尼"
      ],
      flags: ["🇦🇺"]
    },
    {
      key: "法国",
      names: ["法国", "巴黎"],
      flags: ["🇫🇷"]
    },
    {
      key: "乌克兰",
      names: ["乌克兰"],
      flags: ["🇺🇦"]
    }
  ];

  const proxies = Array.isArray(config.proxies)
    ? config.proxies
    : [];

  const groups = Array.isArray(config["proxy-groups"])
    ? config["proxy-groups"]
    : [];

  const rules = Array.isArray(config.rules)
    ? config.rules
    : [];

  function detectRegion(name) {
    // 先按中文识别
    // 可以兼容类似“🇨🇳 台湾W01”这种节点名
    for (const region of regionDefs) {
      if (
        region.names.some(keyword =>
          name.includes(keyword)
        )
      ) {
        return region.key;
      }
    }

    // 再按国旗识别
    for (const region of regionDefs) {
      if (
        region.flags.some(flag =>
          name.includes(flag)
        )
      ) {
        return region.key;
      }
    }

    // 未来机场增加新的国家时，
    // 自动识别国旗并生成对应自动组
    const flag = name.match(
      /(?:[\u{1F1E6}-\u{1F1FF}]){2}/u
    );

    if (flag) {
      return flag[0];
    }

    return "其他地区";
  }

  function nodePenalty(name) {
    // 普通 / IEPL 节点优先
    // 下载专用往后
    // 免费节点最后
    let penalty = 0;

    if (/下载专用/i.test(name)) {
      penalty += 10;
    }

    if (/免费/i.test(name)) {
      penalty += 20;
    }

    return penalty;
  }

  // 保存机场原来的节点顺序
  const originalIndex = new Map();

  // 地区 -> 节点列表
  const regionNodes = new Map();

  proxies.forEach((proxy, index) => {
    if (
      !proxy ||
      typeof proxy.name !== "string" ||
      proxy.name.length === 0
    ) {
      return;
    }

    const name = proxy.name;

    originalIndex.set(name, index);

    const region = detectRegion(name);

    if (!regionNodes.has(region)) {
      regionNodes.set(region, []);
    }

    regionNodes.get(region).push(name);
  });

  // 每个地区内部尽量保留机场原顺序
  // 只把下载专用 / 免费节点往后放
  for (const [region, nodes] of regionNodes) {
    nodes.sort((a, b) => {
      const d =
        nodePenalty(a) -
        nodePenalty(b);

      if (d !== 0) {
        return d;
      }

      return (
        (originalIndex.get(a) ?? 0) -
        (originalIndex.get(b) ?? 0)
      );
    });

    regionNodes.set(region, nodes);
  }

  // 地区排序
  const orderedRegions = [
    ...REGION_PRIORITY.filter(
      region =>
        regionNodes.has(region)
    ),

    ...Array
      .from(regionNodes.keys())
      .filter(
        region =>
          !REGION_PRIORITY.includes(region)
      )
  ];

  const groupNameByRegion =
    new Map(
      orderedRegions.map(
        region => [
          region,
          `${PREFIX}${region}自动`
        ]
      )
    );

  // =========================
  // 每个地区的自动测速组
  // =========================

  const regionGroupObjects =
    new Map();

  for (const region of orderedRegions) {
    regionGroupObjects.set(
      region,
      {
        name:
          groupNameByRegion.get(region),

        type: "url-test",

        proxies: [
          ...regionNodes.get(region)
        ],

        url: HEALTH_URL,

        // 120 秒
        interval: INTERVAL,

        tolerance: TOLERANCE,

        // 不使用这个地区时减少无意义测速
        lazy: true
      }
    );
  }

  const regionGroupNames =
    orderedRegions.map(
      region =>
        groupNameByRegion.get(region)
    );

  const sortedNodeNames =
    orderedRegions.flatMap(
      region =>
        regionNodes.get(region)
    );

  // =========================
  // 🌍 地区自动
  // =========================
  //
  // 这里故意是 select。
  //
  // 例如你选择：
  //
  // ⚡ 日本自动
  //
  // 就只会：
  //
  // 日本W01 -> 日本W03
  //
  // 不会自动：
  //
  // 日本 -> 香港 -> 美国

  const regionSelector = {
    name: REGION_SELECTOR,

    type: "select",

    proxies: [
      ...regionGroupNames
    ]
  };

  // =========================
  // 🧭 手动选择
  // =========================

  const manualSelector = {
    name: MANUAL_SELECTOR,

    type: "select",

    proxies: [
      ...sortedNodeNames,
      "DIRECT"
    ]
  };

  // =========================
  // 🔰 选择节点
  // =========================

  let rootGroup =
    groups.find(
      group =>
        group &&
        group.name === ROOT_SELECTOR
    );

  if (!rootGroup) {
    rootGroup = {
      name: ROOT_SELECTOR,
      type: "select",
      proxies: []
    };
  }

  const rootChoices = [];

  // ---------------------------------
  // 1. 常用自动节点组最前面
  //
  // 日本自动
  // 香港自动
  // 新加坡自动
  // 美国自动
  // ---------------------------------

  for (const region of COMMON_REGIONS) {
    if (regionNodes.has(region)) {
      rootChoices.push(
        groupNameByRegion.get(region)
      );
    }
  }

  // ---------------------------------
  // 2. 地区自动 / 手动选择
  // ---------------------------------

  rootChoices.push(
    REGION_SELECTOR,
    MANUAL_SELECTOR
  );

  // ---------------------------------
  // 3. 常用地区具体单节点
  // ---------------------------------

  for (const region of COMMON_REGIONS) {
    if (regionNodes.has(region)) {
      rootChoices.push(
        ...regionNodes.get(region)
      );
    }
  }

  // ---------------------------------
  // 4. 不常用地区
  //
  // 台湾W01
  // 台湾W02
  // ⚡ 台湾自动
  //
  // 韩国W01
  // 韩国W02
  // ⚡ 韩国自动
  //
  // ...
  // ---------------------------------

  for (const region of OTHER_REGIONS) {
    if (!regionNodes.has(region)) {
      continue;
    }

    rootChoices.push(
      ...regionNodes.get(region)
    );

    rootChoices.push(
      groupNameByRegion.get(region)
    );
  }

  // ---------------------------------
  // 5. 未来新增的其他国家
  //
  // 单节点
  // ↓
  // 对应自动组
  // ---------------------------------

  for (const region of orderedRegions) {
    if (
      REGION_PRIORITY.includes(region)
    ) {
      continue;
    }

    rootChoices.push(
      ...regionNodes.get(region)
    );

    rootChoices.push(
      groupNameByRegion.get(region)
    );
  }

  rootChoices.push("DIRECT");

  rootGroup = {
    ...rootGroup,

    type: "select",

    proxies: rootChoices
  };

  // =========================
  // 🛡️ Tailscale 故障转移
  // =========================
  //
  // 和普通网页不同：
  //
  // Tailscale 为了保证远程机器不断线，
  // 允许跨地区切换。
  //
  // 日本全挂
  // ↓
  // 香港
  // ↓
  // 新加坡
  // ↓
  // 美国
  // ↓
  // 其他地区

  const tsGroup = {
    name: TS_GROUP,

    type: "fallback",

    proxies: [
      ...regionGroupNames
    ],

    url: HEALTH_URL,

    // 60 秒检查一次
    interval: 60,

    // 单次最多等待 3 秒
    timeout: 3000,

    // 连续失败达到 2 次再判定故障
    "max-failed-times": 2,

    // 即使没有打开代理页面也持续检测
    lazy: false
  };

  // =========================
  // 清理旧的脚本生成组
  // =========================

  function isGeneratedGroup(group) {
    if (
      !group ||
      typeof group.name !== "string"
    ) {
      return false;
    }

    if (
      [
        ROOT_SELECTOR,
        REGION_SELECTOR,
        MANUAL_SELECTOR,
        TS_GROUP
      ].includes(group.name)
    ) {
      return true;
    }

    return (
      group.name.startsWith(PREFIX) &&
      group.name.endsWith("自动")
    );
  }

  // 保留机场原来的功能代理组
  const originalGroups =
    groups.filter(
      group =>
        !isGeneratedGroup(group)
    );

  // 常用自动组
  const commonAutoGroups =
    COMMON_REGIONS
      .filter(
        region =>
          regionGroupObjects.has(region)
      )
      .map(
        region =>
          regionGroupObjects.get(region)
      );

  // 不常用自动组
  const uncommonAutoGroups =
    orderedRegions
      .filter(
        region =>
          !COMMON_REGIONS.includes(region)
      )
      .map(
        region =>
          regionGroupObjects.get(region)
      );

  // =========================
  // 整个代理组页面排序
  // =========================

  config["proxy-groups"] = [
    rootGroup,

    regionSelector,

    manualSelector,

    ...commonAutoGroups,

    tsGroup,

    // 保留机场原来的：
    // B站 / 动画疯 / Steam /
    // Cloudflare / OneDrive /
    // 学术网站 / 国内网站 /
    // 广告 / 漏网之鱼等
    ...originalGroups,

    // 台湾、韩国、欧洲等自动组放后面
    ...uncommonAutoGroups
  ];

  // =========================
  // Tailscale 规则
  // =========================

  // 删除以前已有的 Tailscale 规则，
  // 防止每次刷新重复添加
  config.rules =
    rules.filter(rule => {
      if (
        typeof rule !== "string"
      ) {
        return true;
      }

      return !/^DOMAIN-SUFFIX,tailscale\.(com|io),/i
        .test(rule);
    });

  // Tailscale 规则必须放在最前面
  config.rules.unshift(
    `DOMAIN-SUFFIX,tailscale.io,${TS_GROUP}`
  );

  config.rules.unshift(
    `DOMAIN-SUFFIX,tailscale.com,${TS_GROUP}`
  );

  return config;
}
