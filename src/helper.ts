import { baseUrl, mail, password } from "./config";
import axios from "axios";
import { Headers } from "./types";

const getDescendants = async (node: any, locale: any, headers: any) => {
    try {
        const descendants = await axios.get(
            `https://app.contentstack.com/api/v3/content_types/${node._content_type_uid || node.type || node.content_type_uid}/entries/${node.uid}/descendants?locale=${locale.code}`,
            { headers }
        );

        const descendantsData: any = await descendants.data;

        return descendantsData;
    }
    catch(error) {
        console.log("Error", error, node);
    }
}   

const login = async () => {
    try {
        const loginRes = await axios.post(`https://${baseUrl}/v3/user-session`, {
            user: {
                email: mail,
                password
            }
        });

        const loginData: any = await loginRes.data;

        return loginData.user.authtoken;
    }
    catch(error) {
        console.log(error);
        return null;
    }
}

const bfs = async (queue: any, visited: any, res: any, headers: Headers, locales: any) => {
    let chunked: any[] = [];

    const masterLocale = locales.find((locale: any) => locale.fallback_locale === null);

    try {        
        // Process the first node (parent entry)
        const processNode = async (queueItem: any) => {
            const node = queueItem.ref;
            const currLevel = queueItem.level;
            
            // Get variants for the current node
            const variantsResponse = await axios.get(
                `https://${baseUrl}/v3/variant_groups?include_variant_info=true`,
                { headers }
            );
            
            const variantsData: any = await variantsResponse.data; 
            
            // Filter variant groups based on the node's content type
            const filteredVariants = variantsData?.variant_groups?.find((variantGroup: any) => 
                variantGroup?.content_types?.find((contentType: { uid: String, status: String }) => 
                    contentType.uid === (node._content_type_uid || node.type || node.content_type_uid)
                )
            );
            
            // Get localized variants for the current node
            let localisedVariantsEntries = filteredVariants && await Promise.all(filteredVariants?.variants?.map(async (variant: any) => {
                try {
                    return await Promise.all(locales.map(async (locale: any) => {
                        try {
                            const res = await axios.get(
                                `https://${baseUrl}/v3/content_types/${node._content_type_uid || node.type || node.content_type_uid}/entries/${node.uid}/variants/${variant.uid}?locale=${locale.code}`, 
                                { headers }
                            );
                            const { entry }: any = await res.data;
                            return { ...entry, variant_name: variant.name };
                        }
                        catch(error) {
                            return null;
                        }
                    }));
                }
                catch(error) {
                    console.log(error);
                    return null;
                }
            }));
            
            localisedVariantsEntries = localisedVariantsEntries && localisedVariantsEntries?.flat()?.filter((entry: any) => entry && entry._variant);
            
            let filteredData = { references: [] };
            
            // Process base variant entries for all locales
            await Promise.all(locales.map(async (locale: any) => {
                const descendantsData: any = await getDescendants(node, locale, headers);
                
                const filteredReferences = descendantsData.entries_references.map((ref: any) => {
                    return {
                        uid: ref.uid,
                        title: ref.title,
                        locale: locale.code,
                        fallback_locale: (locale.fallback_locale) ? (locale.code === ref.locale) ? locale.fallback_locale : ref.locale : null,
                        ...((locale.code === ref.locale) ? { localised: true } : { localised: false }),
                        version: ref._version,
                        content_type_uid: ref._content_type_uid,
                        parent_uid: queueItem !== queue[0] ? queueItem.ref.parent_uid : undefined,
                        workflow_stage: ref?._workflow?.name
                    }
                });
        
                let filteredChild: any = {
                    uid: descendantsData.uid,
                    title: descendantsData.title,
                    locale: locale.code,
                    fallback_locale: (locale.fallback_locale) ? (locale.code === descendantsData.locale) ? locale.fallback_locale : descendantsData.locale : null,
                    ...(locale.code === descendantsData.locale ? { localised: true } : { localised: false }),
                    version: descendantsData._version,
                    content_type_uid: descendantsData._content_type_uid,
                    references: filteredReferences,
                    variant_name: "Base Entry",
                    variant_uid: "base_variant",
                    workflow_stage: descendantsData?._workflow?.name
                }
                
                if(locale.code === masterLocale.code) {
                    filteredData = filteredChild;
                }
        
                if(filteredChild.localised) {
                    chunked.push(filteredChild);
                    filteredChild.references.forEach((ref: any) => {
                        if(!visited.has(ref.uid)) {
                            visited.add(ref.uid);
                            queue.push({ ref, level: currLevel + 1 })
                        }
                    });
                }
            }));

            // Sort chunked array with master node (fallback_locale === null) first because await Promise.all does not guarantee order
            // why did this - so that the base variant parent entry is always at the start
            // can be removed not needed for any logic wise only for ui solution
            chunked.sort((a, b) => (a.fallback_locale === null ? -1 : b.fallback_locale === null ? 1 : 0));
            
            // Process variants with references
            const localeVariantSet = new Set();
            
            localisedVariantsEntries && localisedVariantsEntries?.forEach((variant: any) => {
                if(variant._metadata && variant._metadata.references) {
                    localeVariantSet.add(variant._variant._uid);
                }
            });
            
            // Add all variant entries
            localisedVariantsEntries && localisedVariantsEntries?.forEach((variant: any) => {
                let data = null;
                if(!variant._metadata || (variant._metadata && !variant._metadata.references)) {
                    data = {...filteredData, 
                        title: variant.title, 
                        locale: variant.locale, 
                        fallback_locale: (masterLocale.code === variant.locale ? null : masterLocale.code),
                        variant_name: variant.variant_name,
                        variant_uid: variant._variant._uid,
                        references: []
                    };
                    
                    if(!localeVariantSet.has(variant._variant._uid)) {
                        data = {...data, fallback_variant: "base_variant"};
                    }
                }
                else {
                    const deletedReferences = new Set();
                    let newReferences = variant._metadata.references.map((ref: any) => {
                        if(!ref.deleted) {
                            let newRef = {...ref, content_type_uid: ref._content_type_uid, locale: masterLocale.code, localised: true};
                            delete newRef._content_type_uid;
                            return newRef;
                        }
                        else {
                            deletedReferences.add(ref.uid);
                            return null;
                        }
                    })
                    .filter((ref: any) => ref);
                    
                    const referenceSet = new Set();
                    newReferences = newReferences.flat().map((ref: any) => {
                        if(!referenceSet.has(ref.uid)) {
                            referenceSet.add(ref.uid);
                            return ref;
                        }
                        return null;
                    }).filter((ref: any) => ref);
                    
                    data = {
                        ...filteredData,
                        title: variant.title,
                        locale: variant.locale,
                        fallback_locale: (masterLocale.code === variant.locale ? null : masterLocale.code),
                        references: newReferences,
                        variant_name: variant.variant_name,
                        variant_uid: variant._variant._uid
                    };
                }
                
                data && chunked.push(data);
                data && data.references.forEach((dataRef: any) => {
                    if(!visited.has(dataRef.uid)) {
                        visited.add(dataRef.uid);
                        queue.push({ ref: dataRef, level: currLevel + 1 })
                    }
                });
            });
        };
        
        // Process all nodes in the queue
        while(queue.length > 0) {
            const currentNode = queue[0];
            const currentLevel = currentNode.level;
            
            // Process the current node
            await processNode(currentNode);
            queue.shift();
            
            // When the current level ends, send the chunk to the client
            if(queue.length > 0 && currentNode.ref.uid !== queue[0].ref.uid) {
                res.write(JSON.stringify({ items: chunked, _is_last_chunk: false }) + "\n");
                chunked = [];
            }
        }
        
        // Send the last chunk
        res.write(JSON.stringify({ items: chunked, _is_last_chunk: true }) + "\n");
        res.end();
    }
    catch(error) {
        console.log("Error in BFS traversal: ", error);
        res.status(500).json({
            message: "Server error"
        });
    }   
}

export { login, bfs };