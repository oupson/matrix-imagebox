
class Transport {
    /**
     * 
     * @param {Window} window 
     */
    constructor(window) {
        this.window = window;
        this.callbacks = {};

        this.onMatrixMessage = null;
        this.window.addEventListener("message", event => this.matrixCallback(event));
    }

    reply(oldMessage, data) {
        oldMessage.response = data;
        this.window.parent.postMessage(oldMessage, "*");
    }

    /**
     * 
     * @param {string} action 
     * @param {any} data 
     * @returns {Promise<any>}
     */
    sendMessage(messageAction, messageData) {
        const requestId = `action-${Date.now()}`;
        const message = {
            api: "fromWidget",
            action: messageAction,
            widgetId: this.widgetId,
            requestId: requestId,
            data: messageData
        };
        console.log(message);
        this.window.parent.postMessage(message, "*");

        const callbackDict = this.callbacks;
        return new Promise((resolve, reject) => {
            callbackDict[requestId] = [resolve, reject];
            setInterval(() => {
                if (this.callbacks[message.requestId] !== undefined) {
                    delete this.callbacks[message.requestId];
                    reject(new Error("timeout waiting response"));
                } else {
                    console.debug("Already resolved")
                }
            }, 10000);
        });
    }

    matrixCallback(event) {
        console.debug("matrixCallback", event);
        if (this.widgetId == null) {
            this.widgetId = event.data.widgetId;
        }

        const message = event.data;

        if (message.api == "fromWidget") {
            if (this.callbacks[message.requestId] !== undefined) {
                console.log("resolving");
                const [resolve, _] = this.callbacks[message.requestId];
                delete this.callbacks[message.requestId];
                resolve(message);
            } else {
                console.warn("missing callback");
            }
        } else {
            if (this.onMatrixMessage != null) {
                this.onMatrixMessage(event);
            }
        }
    }
}

class Widget {
    constructor(window) {
        this.key = null;
        this.transport = new Transport(window);
        this.transport.onMatrixMessage = (e) => this.onMatrixMessage(e);
        this.widgetId = null;
        this.imgLimit = 50;
        this.imgGrid = document.getElementById("img-grid");
        this.searchButton = document.getElementById("search");
        this.searchButton.disabled = true;
        const searchText = document.getElementById("search-box");

        this.searchButton.onclick = () => {
            if (searchText.value) {
                this.showSearchResults(searchText.value);
                searchText.value = "";
            }
        };

        searchText.onkeydown = (event) => {
            if (event.code === "Enter" && searchText.value) {
                this.showSearchResults(searchText.value);
                searchText.value = "";
            }
        };

        fetch("/keys.json").then(r => r.json()).then(o => this.key = o.key);
    }

    async showSearchResults(search) {
        const apiResult = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(search)}&key=${this.key}&limit=${this.imgLimit}`)
            .then((r) => r.json());
        const results = apiResult.results;

        this.imgGrid.replaceChildren();
        for (const img of results) {
            const imgUrl = img.media_formats.gif.url;

            const imageWidget = document.createElement("img");
            imageWidget.src = imgUrl;
            imageWidget.onclick = (_e) => this.sendImage(imgUrl);

            this.imgGrid.appendChild(imageWidget);
        }
    }

    onMatrixMessage(event) {
        console.debug("onMatrixMessage", event);
        const message = event.data;
        if (message.action === "capabilities") {
            this.widgetId = message.widgetId;
            const response = {
                "capabilities": ["org.matrix.msc2762.send.event:m.room.message#m.image", "org.matrix.msc4039.upload_file"]
            };

            this.transport.reply(message, response)
        } else if (message.action === "notify_capabilities") {
            if (message.data.approved.includes("org.matrix.msc2762.send.event:m.room.message#m.image") && message.data.approved.includes("org.matrix.msc4039.upload_file")) {
                this.searchButton.disabled = false;
            } else {
                console.error("Missing permissions");
            }
            this.transport.reply(message, {});
        }
    }

    async sendImage(gifUrl) {
        const img = await fetch(gifUrl)
            .then(r => r.blob());

        const responseMessage = await this.transport.sendMessage("org.matrix.msc4039.upload_file", {
            file: img
        });

        const uri = responseMessage.response.content_uri;

        const s = await this.transport.sendMessage("send_event", {
            "type": "m.room.message",
            "content": {
                "msgtype": "m.image",
                "url": uri,
                "info": {
                    "mimetype": "image/gif",
                },
                "body": ""
            }
        });
        console.log("send", s);
    }
}

const widget = new Widget(window);
