class MIA {
    constructor(options) {
        this.data = options.data;
        this.root = document.querySelector(options.el);
        this.method = options.method;
        this.sp = new StrategyPool(this.data, this.method);
        this.initData(); //初始化
    }

    initData() {
        // 遍历每个节点，将对应的处理策略注册到策略池中,通过this.data中的字段来引用这些处理策略
        this.eachNode(this.root);
        // 页面中出现的key，反向注册到其setter方法
        let keys = Object.keys(this.sp.pool);
        keys.forEach(key => { this.defineProperty(this.data, key) });
    }

    defineProperty(data, complexKey) {
        // 获取该复杂key所属的对象
        let keyOfObj = StrategyPool.keyOfObj(data, complexKey);
        // 获取该复杂key的最后一个key
        let key = complexKey.split(".").pop();
        // 获取value
        let value = keyOfObj[key];
        // 获取该复杂key对应的处理函数的数组
        let processors = this.sp.pool[complexKey];
        // 注册setter事件
        Object.defineProperty(keyOfObj, key, {
            enumerable: true,
            configurable: false,
            set: function (newVal) {
                if (newVal === value) return;
                value = newVal;
                processors.forEach((processor) => { processor.do() })
            },
            get: function () {
                return value;
            }
        });
        // 初始化,即执行所有处理函数
        (processors) && (processors.forEach((processor) => { processor.init() }))
    }

    eachNode(node) {
        switch (node.nodeType) {
            // 普通元素
            case Node.ELEMENT_NODE:
                this.sp.elementNodeRegister(node);
                break;
            // 文本节点
            case Node.TEXT_NODE:
                this.sp.textNodeRegister(node);
                break;
        }
        // 递归
        let childNodes;
        if (node.hasChildNodes() && (childNodes = node.childNodes)) {
            for (let index = 0; index < childNodes.length; index++) {
                this.eachNode(childNodes[index]);
            }
        }
    }
}

// 策略池，当初始化时，遍历每一个元素时都会通过策略池来决定要注册的事件
class StrategyPool {
    constructor(data, method) {
        // 策略池，{key : [processor1, processor2..], key2: {processor1, processor2..}}
        this.pool = {};
        // 正则表达式
        this.exp = {
            text: /\{\{\s?(.[^\}\s]*)\s?\}\}/,
            key: /^[\w\d\._]+$/,
            method: /^v-on\:\w+/,
            methodWithParam: /[\w\d]+\(.+\)$/,
            extractMethodName: /^([\w\d]+)\(.*/,
            extractParam: /[\w\d]+\([\s]?(.*)[\s]?\)$/,
            splitParam: /,\s*/,
            integerExp: /^\d+$/,
            stringExp: /^["']{1}(.+)["']{1}$/,
            referenceExp: /^[\w\d\._]+$/,
        }
        // 引用MIA options中的data
        this.data = data;

        // 引用MIA options中的method
        this.method = method;

        // 特定属性
        this.specialAttrs = ["v-model", "v-value", "v-text", "v-on"];
        // 拥有该属性的元素的渲染方式，当options.data中的字段的值被修改后自动执行对应方法修改该元素的相关内容
        this.specialMethod = {
            "v-model": function (element) {
                switch (element.type) {
                    case "checkbox":
                        return (packet) => { packet.node.checked = (StrategyPool.val(packet.data, packet.key)) ? "checked" : "" };
                    case "radio":
                        return (packet) => { packet.node.checked = (packet.node.value === StrategyPool.val(packet.data, packet.key)) ? "checked" : "" };
                    default:
                        return (packet) => { packet.node.value = StrategyPool.val(packet.data, packet.key) };
                }
            }
        };

        // 拥有该属性的元素的初始化方法，修改该元素的相关内容为options.data中对应的字段的值，并且注册事件
        this.specialInitMethod = {
            "v-model": function (element) {
                switch (element.type) {
                    case "checkbox":
                        return (packet) => {
                            packet.node.checked = (StrategyPool.val(packet.data, packet.key)) ? "checked" : "";
                            packet.node.addEventListener("input", () => { StrategyPool.val(packet.data, packet.key, (packet.node.checked)) })
                        }
                    case "radio":
                        return (packet) => {
                            packet.node.checked = (packet.node.value === StrategyPool.val(packet.data, packet.key)) ? "checked" : ""
                            packet.node.addEventListener("input", () => { StrategyPool.val(packet.data, packet.key, packet.node.value) })
                        };
                    default:
                        return (packet) => {
                            packet.node.value = StrategyPool.val(packet.data, packet.key);
                            packet.node.addEventListener("input", () => { StrategyPool.val(packet.data, packet.key, packet.node.value) })
                        }
                }
            }
        };
    }

    //将文本节点的处理策略(TextProcessor)注册到策略池(StrategyPool.pool)中
    textNodeRegister(node) {
        const txt = node.textContent; // 永久记录该文本节点的内容初始值
        let tempTxt = node.textContent; // 此处获取该文本节点的内容，用来查询其中出现的所有key，即options中的data字段
        let keys = []; // 当前文本中包含的所有key，即options中的data的字段
        let PcSorCollector = []; // 用于收集每个key对应的处理器集合，相当于二维数组
        while (this.exp.text.test(tempTxt)) {
            let key = this.exp.text.exec(tempTxt)[1].trim();
            if (this.exp.key.test(key)) {//如果是纯字母组合
                let processors = (this.pool[key]) || (this.pool[key] = []);
                keys.push(key);
                PcSorCollector.push(processors);
                //消除当前key
                tempTxt = tempTxt.replace(new RegExp("\\{\\{\\s?(" + key + "[^\\}\\s]*)\\s?\\}\\}", "gm"), "")
            } else {//todo 运算符处理
                console.log("运算符待处理");
            }
        };
        PcSorCollector.forEach(processors => {
            processors.push(new TextProcessor(keys, node, txt, this.data))
        });
    }

    elementNodeRegister(element) {
        // 收集有用属性
        let attrCollector = [].filter.call(element.attributes, (attr) => { return (this.specialAttrs.indexOf(attr.name.split(":")[0]) != -1) });
        // 有用属性为0，结束
        if (attrCollector.length == 0) return;

        attrCollector.forEach(attr => {
            const key = attr.value.trim(); const name = attr.name;
            if (this.exp.method.test(name)) {// 如果通过该属性是v-on开头的，则直接注册相关事件即可
                this.methodProcess(key, name, element);
            } else if (this.exp.key.test(key)) {// 如果该属性不是v-on开头的，并且该属性的值(key)只是简单的变量名，则为该元素创建对应的setter事件
                // 获取该key在策略池中保存的策略组，然后将新的策略添加到组中
                let processors = this.pool[key] || (this.pool[key] = []);
                processors.push(new ElementProcessor(key, element, this.data, this.specialMethod[name](element), this.specialInitMethod[name](element)));
            } else {//todo 运算符处理
                console.log("运算符待处理");
            }
        })
    }

    // 通过复杂key(options.data.more.m1)从options.data中对应的字段设置的值
    static val(data, complexKey, newVal) {
        let hierarchy = complexKey.split(".");
        let value = data;
        if (newVal === undefined) {
            for (let index = 0; index < hierarchy.length; index++) {
                const key = hierarchy[index];
                value = value[key];
            }
            return value || null;
        } else {
            StrategyPool.keyOfObj(data, complexKey)[hierarchy.pop()] = newVal;
            return newVal;
        }
    }

    // 获取该复杂key所在的对象
    static keyOfObj(data, complexKey) {
        let hierarchy = complexKey.split(".");
        let value = data;
        for (let index = 0; index < hierarchy.length - 1; index++) {
            const key = hierarchy[index];
            value = value[key];
        }
        return value;
    }

    // v-on开头的属性处理策略，适配多种方法的调用，例如:无参，有参，参数为引用MIA options中的data数据的
    methodProcess(attrVal, arrtName, element) {
        if (this.exp.key.test(attrVal)) {// 如果是单纯的变量名类型，表示调用的是无参方法，直接添加事件即可
            element.addEventListener(arrtName.split(":")[1], this.method[attrVal]);
        } else if (this.exp.methodWithParam.test(attrVal)) {// 如果该字符串中类似("method(str)"),说明调用的是带参数的方法
            // 提取该字符串中表示参数的部分，最终变成一个参数数组，但是这个数组全部都是字符串类型的数据，因此需要继续处理
            let params = attrVal.match(this.exp.extractParam)[1].split(this.exp.splitParam);
            // 这个数组存储的是上面的参数的处理方法，当调用后的返回值是真正的参数
            let args = [];
            for (let index = 0; index < params.length; index++) {
                let param = params[index];
                if (this.exp.integerExp.test(param)) {// 如果该参数是纯数字，解析该数字即可 todo double类型的还不支持
                    param = parseInt(param);
                    // 这里实际存储的是一个方法，当调用该方法后才返回真正的参数，这样做是为了适配引用类型的数据，因为引用类型的数据的动态的，每次执行的结果都不同
                    args[index] = () => { return param };
                } else if (this.exp.stringExp.test(param)) {// 如果该参数是字符串类型的，类似这种('西瓜')
                    param = param.replace(/["']/g, "");
                    args[index] = () => { return param };
                } else if (this.exp.referenceExp.test(param)) {// 如果该参数是引用数据类型的，只是单纯的变量名(title, more.m1)
                    args[index] = () => { return StrategyPool.val(this.data, param) };
                }
            }
            // 当参数处理完毕后，得到一个args数组，这个数组中存储的都是方法，当调用后获取真正的参数
            // arrtName.split(":")[1] 这里会得到事件类型(click, input, change)
            // () => { this.method[attrVal.match(this.exp.extractMethodName)[1]](...[].map.call(args, (arg) => { return arg() })) }
            // 该事件要执行的方法 this.method[attrVal.match(this.exp.extractMethodName)[1]]
            // 参数列表 (...[].map.call(args, (arg) => { return arg() })) }) 将args转换为真正的参数
            element.addEventListener(arrtName.split(":")[1], () => { this.method[attrVal.match(this.exp.extractMethodName)[1]](...[].map.call(args, (arg) => { return arg() })) })
        } else {
            console.log("运算表达式待处理！");
        }
    }
}

class TextProcessor {
    constructor(keys, node, text, data) {
        this.node = node;
        this.textSource = text;
        this.keys = keys;
        this.data = data
        this.nExps = {};
        this.keys.forEach(key => { this.nExps[key] = new RegExp("\\{\\{\\s?(" + key + "[^\\}\\s]*)\\s?\\}\\}", "gm") })
    }

    do() {
        let text = this.textSource;
        this.keys.forEach(key => {
            text = text.replace(this.nExps[key], StrategyPool.val(this.data, key) || "");
        })
        this.node.textContent = text;
    }

    init() {
        this.do();
    }
}

class ElementProcessor {
    constructor(key, node, data, method, initMethod) {
        this.node = node;
        this.key = key;
        this.data = data;
        this.method = method;
        this.initMethod = initMethod;
    }

    do() {
        (this.method) && this.method(this);
    }

    init() {
        this.initMethod(this);
    }
}