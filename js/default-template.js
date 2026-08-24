const LEGACY_DEFAULT_TEMPLATE = {
  schemaVersion: 1,
  id: "ear-anthropometry-survey",
  version: "1.0",
  title: "佩戴耳厚数据采集",
  description: "由研究人员完成的左耳厚度、佩戴习惯与主观体验记录。",
  fields: [
    {
      id: "name",
      type: "shortText",
      label: "姓名",
      description: "请输入参与者姓名，也可以选择匿名记录。",
      required: true,
      placeholder: "请输入姓名",
      allowAnonymous: true,
      anonymousLabel: "匿名记录"
    },
    {
      id: "gender",
      type: "singleChoice",
      label: "性别",
      required: true,
      options: [
        { "id": "male", "label": "男" },
        { "id": "female", "label": "女" }
      ]
    },
    {
      id: "age",
      type: "number",
      label: "年龄",
      description: "请输入参与者的周岁年龄。",
      required: true,
      integer: true,
      unit: "岁",
      placeholder: "例如：28"
    },
    {
      id: "horizontalThickness",
      type: "number",
      label: "左耳水平佩戴位置厚度",
      description: "耳夹处于水平佩戴位置时，使用治具测量左耳厚度。",
      required: true,
      unit: "mm",
      placeholder: "输入治具显示的数值"
    },
    {
      id: "tiltedThickness",
      type: "number",
      label: "左耳倾斜佩戴位置厚度",
      description: "优先按照参与者习惯的倾斜位置测量；没有明确习惯时按约45°测量。",
      required: true,
      unit: "mm",
      placeholder: "输入治具显示的数值"
    },
    {
      id: "wearHabit",
      type: "singleChoice",
      label: "耳夹佩戴习惯",
      description: "参与者通常以哪种角度佩戴耳夹式耳机？",
      required: false,
      options: [
        { "id": "horizontal", "label": "A－水平" },
        { "id": "tilt45", "label": "B－倾斜约45°" },
        { "id": "tiltOver45", "label": "C－倾斜大于45°" },
        {
          "id": "other",
          "label": "D－其他",
          "textInput": {
            "label": "请说明其他佩戴方式",
            "placeholder": "请输入具体佩戴方式",
            "required": true
          }
        }
      ]
    },
    {
      id: "earSize",
      type: "singleChoice",
      label: "耳型大小评价",
      description: "请研究人员根据观察，对参与者左耳进行辅助评价。",
      required: false,
      options: [
        { "id": "large", "label": "大" },
        { "id": "medium", "label": "中" },
        { "id": "small", "label": "小" }
      ]
    },
    {
      id: "openEarPreference",
      type: "singleChoice",
      label: "开放式耳机偏好",
      description: "在开放式耳机中，参与者更喜欢哪一种形式？",
      required: false,
      options: [
        { "id": "clip", "label": "耳夹式" },
        { "id": "hook", "label": "耳挂式" }
      ]
    },
    {
      id: "preferenceReason",
      type: "longText",
      label: "偏好原因",
      description: "请在不改变原意的前提下，精炼记录参与者的回答。",
      required: false,
      placeholder: "请输入主要原因"
    },
    {
      id: "sensitivity",
      type: "rating",
      label: "耳朵对耳机佩戴不适的敏感程度",
      description: "请参与者结合过去佩戴不同耳机的经历进行自我评价。",
      required: false,
      min: 1,
      max: 5,
      unknownOption: { "id": "unknown", "label": "无法判断" },
      labels: {
        "1": { "short": "很不敏感", "help": "佩戴大多数耳机通常都不会不舒服，即使长时间佩戴也很少出现明显疼痛或压迫感。" },
        "2": { "short": "较不敏感", "help": "大部分时间佩戴耳机都不会不舒服，只有少数耳机或佩戴很久后才可能出现轻微不适。" },
        "3": { "short": "一般敏感", "help": "与大多数人接近。合适的耳机可以正常佩戴，但不合适或长时间佩戴时会出现不适。" },
        "4": { "short": "较敏感", "help": "比一般人更容易出现压迫、胀痛或其他不适，对耳机的尺寸、结构和佩戴位置比较挑剔。" },
        "5": { "short": "非常敏感", "help": "多种耳机都容易在较短时间内引起明显不适，经常需要调整位置、缩短佩戴时间或停止佩戴。" }
      }
    },
    {
      id: "painLocations",
      type: "multiChoice",
      label: "一般疼痛位置",
      description: "请根据图片选择参与者通常出现疼痛的位置，可以多选。",
      required: false,
      image: {
        "src": "./assets/ear-pain-points.png",
        "alt": "左耳疼痛位置点位示意图"
      },
      options: [
        { "id": "point1", "label": "点位1" },
        { "id": "point1Back", "label": "点位1背面" },
        { "id": "point2", "label": "点位2" },
        { "id": "point2Back", "label": "点位2背面" },
        { "id": "point3", "label": "点位3" },
        { "id": "point3Back", "label": "点位3背面" },
        { "id": "point4", "label": "点位4" },
        { "id": "point4Back", "label": "点位4背面" },
        { "id": "none", "label": "无", "exclusive": true }
      ]
    }
  ]
};

function repeatedThicknessField(field, description) {
  return {
    ...field,
    type: "repeatedNumber",
    description,
    repeatCount: 3,
    minEntries: 1,
    placeholder: "输入治具显示的数值"
  };
}

export const DEFAULT_TEMPLATE = {
  ...LEGACY_DEFAULT_TEMPLATE,
  version: "1.1",
  description: "由研究人员完成的左耳最小接触厚度、佩戴习惯与主观体验记录。",
  fields: LEGACY_DEFAULT_TEMPLATE.fields.map((field) => {
    if (field.id === "horizontalThickness") {
      return repeatedThicknessField(
        field,
        "在同一水平佩戴位置测量1至3次。每次取下治具后重新定位；治具刚好接触耳部表面，避免明显压迫或变形。"
      );
    }
    if (field.id === "tiltedThickness") {
      return repeatedThicknessField(
        field,
        "优先按照参与者习惯的倾斜位置测量，没有明确习惯时按约45°测量。测量1至3次，每次取下治具后重新定位；治具刚好接触耳部表面，避免明显压迫或变形。"
      );
    }
    return field;
  })
};

export const BUILT_IN_TEMPLATES = [LEGACY_DEFAULT_TEMPLATE, DEFAULT_TEMPLATE];

export function templateKey(template) {
  return `${template.id}@${template.version}`;
}
