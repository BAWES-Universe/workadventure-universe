import FormData from "form-data";
import axios from "axios";
import {signedInPlayHeaders} from "./testAuth";

export async function uploadFile(uploadUrl: string, fileList: {name: string, contents: string}[], headers: Record<string, string> = signedInPlayHeaders()) {
        const formData = new FormData();
        fileList.forEach(entry => {
            const fileBuffer = Buffer.from(entry.contents, "utf-8")
            formData.append('file', fileBuffer, entry.name);
        })

        return await axios.post(uploadUrl, formData.getBuffer(), {
            headers: {...formData.getHeaders(), ...headers}
        });
    }
